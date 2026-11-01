// Панель логиста (Э4, D5): список заявок, подтверждение, назначение с проверками.

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb, getTariffs } from "@/lib/db";
import { calculateQuote, recalculate, type QuoteSnapshot, type VehicleClass } from "@/lib/pricing";
import { tariffDrift } from "@/lib/ops";
import { confirmOrderAction, recalcOrderAction, cancelOrderAction, assignOrderAction, closeOrderAction, forceCloseOrderAction } from "@/lib/actions";
import type BetterSqlite3 from "better-sqlite3";
import RouteMapLazy from "@/components/route-map-lazy";
import { SubmitButton } from "@/components/submit-button";
import { RevisionForm } from "@/components/revision-form";
import { RevisionDecision } from "@/components/revision-decision";
import { revisionFieldDiff } from "@/lib/revision";

export const metadata: Metadata = { title: "Панель логиста", robots: { index: false } };
export const instant = false;

const STATUS_LABEL: Record<string, string> = {
  new: "Новая заявка",
  confirmed: "Подтверждена",
  assigned: "Машина назначена",
  enroute: "В пути",
  acceptance: "Приёмка",
  closed: "Закрыт",
  cancelled: "Отменён",
};

const CHIP_CLASS: Record<string, string> = {
  new: "chip chip-dispatched",
  confirmed: "chip",
  assigned: "chip chip-transit",
  enroute: "chip chip-transit",
  acceptance: "chip chip-trust",
  closed: "chip chip-trust",
  cancelled: "chip chip-neutral",
};

function fmt(cents: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso + "T12:00:00"));
}

interface OrderRow {
  id: number;
  ref: string;
  status: string;
  contact_name: string;
  volume_m3: number;
  distance_km: number;
  move_date: string;
  gross_cents: number;
  vehicle_class: VehicleClass;
  snapshot: string;
  from_text: string;
  to_text: string;
  pending_snapshot: string | null;      // D10
  revision_requested_by: string | null; // D10
}

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Действующая (не отменённая/закрытая) бронь ресурсов на дату — для отображения конфликтов. */
function busyMap(db: BetterSqlite3.Database): Map<string, string> {
  const rows = db.prepare(
    `SELECT a.resource_type, a.resource_id, a.move_date, o.ref
     FROM assignments a JOIN orders o ON o.id = a.order_id
     WHERE o.status IN ('confirmed','assigned','enroute')`,
  ).all() as Array<{ resource_type: string; resource_id: number; move_date: string; ref: string }>;
  const m = new Map<string, string>();
  for (const r of rows) m.set(`${r.resource_type}:${r.resource_id}:${r.move_date}`, r.ref);
  return m;
}

/** Один выбор за раз: результат последнего экшена — конкретный текст (код + ref в тексте, D-UX). */
const ACTION_MSG: Record<string, string> = {
  ok: "Готово.",
  confirmed: "Цена подтверждена — заявка переведена в статус «Подтверждена».",
  assigned: "Машина и бригада назначены — клиент видит статус «Машина назначена».",
  closed: "Заказ закрыт, счёт создан в бухгалтерии.",
  force_closed: "Заказ принудительно закрыт (клиент не подтвердил приёмку). Счёт создан.",
  cancelled: "Заявка отменена.",
  recalculated: "Заявка пересчитана по текущим тарифам.",
  busy: "Конфликт: ресурс уже занят на эту дату.",
  codriver: "Смена >10 ч — требуется второй водитель.",
  drift: "Тарифы изменились — требуется пересчёт.",
  vehicle: "Машина не подходит (вместимость/класс/активность).",
  date: "Дата уже в прошлом.",
  state: "Статус не позволяет операцию.",
  role: "Недостаточно прав.",
  pending: "Сначала завершите правку: заявка ждёт подтверждения изменения.",
};

/** ref подставляется в текст баннера: «Готово: MS-2026-8941 — …». */
function bannerText(code: string, ref?: string): string {
  const base = ACTION_MSG[code] ?? code;
  if (!ref) return base;
  const okCodes = ["confirmed", "assigned", "closed", "force_closed", "cancelled", "recalculated"];
  if (okCodes.includes(code)) return `${ref}: ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  return `${ref}: ${base}`;
}

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ status?: string; msg?: string; ref?: string }> }) {
  await connection();
  const user = await requireRole(["logist", "admin"], "/dispatch");
  const { status: statusFilter, msg, ref } = await searchParams;
  const db = getDb();

  const rows = (
    db.prepare(
      `SELECT id, ref, status, contact_name, volume_m3, distance_km, move_date, gross_cents, vehicle_class, snapshot, from_text, to_text, pending_snapshot, revision_requested_by
       FROM orders WHERE status != 'cancelled'
       ORDER BY CASE WHEN status = 'new' THEN 0 ELSE 1 END, move_date ASC, id ASC
       LIMIT 200`,
    ).all() as OrderRow[]
  );

  const filtered = statusFilter && statusFilter !== "all" ? rows.filter((r) => r.status === statusFilter) : rows;

  const vehicles = db.prepare("SELECT id, plate, label, class, capacity_m3, active FROM vehicles WHERE active = 1 ORDER BY capacity_m3").all() as
    Array<{ id: number; plate: string; label: string; class: VehicleClass; capacity_m3: number; active: number }>;
  const drivers = db.prepare("SELECT id, name FROM users WHERE role = 'driver' AND active = 1 ORDER BY name").all() as
    Array<{ id: number; name: string }>;

  const busy = busyMap(db);
  const tariffs = getTariffs(db); // D8.7/Э7: дрифт относительно ТЕКУЩИХ тарифов

  // D11: сводка ближайших дней (5 дней) — заказы/машины/водители/заявки в очереди
  const { todayIsoBerlin, resourceBookings, dayAvailability } = await import("@/lib/availability");
  const today = todayIsoBerlin();
  const summary = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const rb = resourceBookings(db, iso);
    const av = dayAvailability(db, iso, {});
    return { iso, orders: rb.busyVehicleIds.length, pending: rb.pendingOrders, freeV: av.freeSuitable, freeD: av.freeDrivers, maxV: av.maxVehicles, maxD: av.maxDrivers, status: av.status };
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Панель логиста</h1>
          <p className="text-muted">{user.name} · новых заявок: {rows.filter((r) => r.status === "new").length}</p>
        </div>
        <form className="flex items-center gap-2">
          <select name="status" defaultValue={statusFilter ?? "all"} className="input-base w-48" aria-label="Фильтр по статусу">
            <option value="all">Все статусы</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button type="submit" className="btn btn-secondary">Показать</button>
        </form>
      </header>

      {msg && ACTION_MSG[msg] && (
        <div className={`mb-4 rounded-base border p-3 text-sm ${msg.startsWith("ok") || ["confirmed", "assigned", "closed", "force_closed", "cancelled", "recalculated"].includes(msg) ? "border-trust/40 bg-emerald-50" : "border-danger/30 bg-red-50"}`} role="status" aria-live="polite">
          {bannerText(msg, ref)}
        </div>
      )}

      {/* D11: сводка ближайших 5 дней */}
      <section className="mb-6 card p-4">
        <h2 className="mb-2 text-sm font-semibold">Ближайшие дни</h2>
        <div className="grid gap-2 text-sm sm:grid-cols-5">
          {summary.map((s) => (
            <div key={s.iso} className={`rounded-base border px-3 py-2 ${s.status === "busy" ? "border-red-200 bg-red-50" : s.status === "partial" ? "border-amber-200 bg-amber-50" : "border-trust/30 bg-emerald-50"}`}>
              <div className="font-medium">{s.iso.slice(8)}.{s.iso.slice(5, 7)}</div>
              <div className="text-xs text-muted">{s.orders} заказ(ов) · {s.freeV}/{s.maxV} машин · {s.freeD}/{s.maxD} водителей</div>
              {s.pending > 0 && <div className="text-xs text-accent">{s.pending} заявок в очереди</div>}
            </div>
          ))}
        </div>
      </section>

      {filtered.length === 0 && (
          <div className="card p-8 text-center text-ink">Заявок пока нет. Как только клиент оформит расчёт, заявка появится здесь.</div>
      )}

      <div className="grid gap-4">
        {filtered.map((o) => {
          const snap = JSON.parse(o.snapshot) as QuoteSnapshot;
          const priceChanged = tariffDrift(snap, o.gross_cents, tariffs); // D8.7: vs текущие тарифы
          const expired = new Date(snap.quoteValidUntil).getTime() < new Date(todayIso() + "T12:00:00").getTime();
          const needsSecond = (() => { try { return recalculate(snap).needsSecondDriver; } catch { return false; } })();
          const routeRow = db.prepare("SELECT geometry FROM route WHERE order_id = ?").get(o.id) as { geometry: string | null } | undefined;
          const geometry = routeRow?.geometry ? (JSON.parse(routeRow.geometry) as [number, number][]) : null;
          // D10: активная правка
          const pendingSnap = o.pending_snapshot ? (JSON.parse(o.pending_snapshot) as QuoteSnapshot) : null;

          return (
            <section key={o.id} className="card p-5" data-order-ref={o.ref}>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/order/${o.ref}`} className="font-bold text-primary underline-offset-2 hover:underline">{o.ref}</Link>
                <span className={CHIP_CLASS[o.status]}>{STATUS_LABEL[o.status]}</span>
                <span className="chip chip-neutral">Класс {o.vehicle_class}</span>
                {needsSecond && <span className="chip chip-delayed">Смена &gt;10 ч — нужен 2-й водитель</span>}
                {pendingSnap && (
                  <span className="chip chip-dispatched">
                    {o.revision_requested_by === "kunde" ? "Правка клиента — требуется решение" : "Ждёт подтверждения клиента"}
                  </span>
                )}
                {o.move_date < todayIso() && o.status !== "new" && o.status !== "confirmed" && <span className="chip chip-delayed">Дата прошла</span>}
              </div>
              <p className="mt-2 text-sm">
                {o.contact_name} · {o.from_text} → {o.to_text}
              </p>
              <p className="mt-1 text-sm text-muted">
                {dateLabel(o.move_date)} · {o.volume_m3} м³ · {o.distance_km} км · {fmt(o.gross_cents)} · расчёт действителен до {dateLabel(snap.quoteValidUntil)}
              </p>
              {geometry && <div className="mt-3"><RouteMapLazy geometry={geometry} fromText={o.from_text} toText={o.to_text} height={200} /></div>}

              {(priceChanged || expired) && o.status === "new" && (
                <div className="mt-3 rounded-base border border-danger/30 bg-red-50 p-3 text-sm">
                  {priceChanged ? "Тарифы изменились после расчёта." : "Срок действия расчёта истёк."}{" "}
                  <span className="text-muted">Старая цена: {fmt(o.gross_cents)} → по текущим тарифам: {fmt(calculateQuote(snap.config, tariffs).gross)}.</span>
                  <form action={async () => { "use server"; const r = await recalcOrderAction(o.id); redirectMsg(r.ok ? "recalculated" : r.error ?? "state", o.ref); }} className="mt-2">
                    <SubmitButton>Пересчитать по текущим тарифам</SubmitButton>
                  </form>
                </div>
              )}

              {(o.status === "new" || o.status === "confirmed") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {o.status === "new" && !priceChanged && !expired && (
                    <form action={async () => { "use server"; const r = await confirmOrderAction(o.id); redirectMsg(r.ok ? "confirmed" : r.error ?? "state", o.ref); }}>
                      <SubmitButton>Подтвердить цену</SubmitButton>
                    </form>
                  )}
                  <CancelForm orderId={o.id} orderRef={o.ref} />
                </div>
              )}

              {pendingSnap && o.revision_requested_by === "kunde" && (o.status === "new" || o.status === "confirmed") && (
                <div className="mt-3 rounded-base border border-accent-soft bg-orange-50 p-3 text-sm">
                  <p className="font-semibold">Клиент запросил изменение:</p>
                  <RevisionDiffList currentSnap={snap} pendingSnap={pendingSnap} />
                  <p className="mt-1">Цена: <span className="text-muted line-through">{fmt(recalculate(snap).gross)}</span> → <b>{fmt(recalculate(pendingSnap).gross)}</b></p>
                  <div className="mt-2">
                    <RevisionDecision orderId={o.id} kind="accept" />
                  </div>
                </div>
              )}

              {(o.status === "new" || o.status === "confirmed") && !pendingSnap && (
                <div className="mt-3">
                  <RevisionForm
                    orderId={o.id}
                    role="logist"
                    canRevise={true}
                    deadlineHint=""
                    current={{
                      volumeM3: snap.config.volumeM3,
                      floorsFrom: snap.config.floorsFrom,
                      floorsTo: snap.config.floorsTo,
                      elevatorFrom: snap.config.elevatorFrom,
                      elevatorTo: snap.config.elevatorTo,
                      boxes: snap.config.boxes,
                      kitchen: snap.config.kitchen,
                      furnitureItems: snap.config.furnitureItems,
                      packHours: snap.config.packHours,
                      hvzZones: snap.config.hvzZones,
                      extraCrew: snap.config.extraCrew,
                      express: snap.config.express ?? false,
                      sharedLoad: snap.config.sharedLoad ?? false,
                    }}
                  />
                </div>
              )}

              {o.status === "confirmed" && !pendingSnap && (
                <AssignForm
                  orderId={o.id}
                  vehicles={vehicles}
                  drivers={drivers}
                  orderClass={o.vehicle_class}
                  orderVolume={o.volume_m3}
                  moveDate={o.move_date}
                  busy={busy}
                  orderRef={o.ref}
                />
              )}

              {o.status === "acceptance" && (
                <form action={async () => { "use server"; const r = await closeOrderAction(o.id); redirectMsg(r.ok ? "closed" : "state", o.ref); }} className="mt-3">
                  <SubmitButton>Закрыть заказ и создать счёт</SubmitButton>
                </form>
              )}

              {o.status === "enroute" && (
                <form action={async () => { "use server"; const r = await forceCloseOrderAction(o.id); redirectMsg(r.ok ? "force_closed" : r.message?.includes("правку") ? "pending" : "state", o.ref); }} className="mt-3">
                  <SubmitButton className="btn btn-outline h-9">Принудительное закрытие (клиент не подтвердил)</SubmitButton>
                </form>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}

function CancelForm({ orderId, orderRef }: { orderId: number; orderRef?: string }) {
  return (
    <form action={async () => { "use server"; const r = await cancelOrderAction(orderId); redirectMsg(r.ok ? "cancelled" : r.error ?? "state", orderRef); }}>
      <SubmitButton className="btn btn-outline h-9">Отменить</SubmitButton>
    </form>
  );
}

/** Результат экшена → редирект с конкретным сообщением (код + ref заказа, чтобы было ясно ЧТО произошло). */
async function redirectMsg(code: string, ref?: string): Promise<never> {
  "use server";
  const { redirect } = await import("next/navigation");
  return redirect(`/dispatch?msg=${code}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`);
}

/** Diff-список изменённых полей правки (D10: логист видит, ЧТО именно изменил клиент). */
function RevisionDiffList({ currentSnap, pendingSnap }: { currentSnap: QuoteSnapshot; pendingSnap: QuoteSnapshot }) {
  const diff = revisionFieldDiff(currentSnap, pendingSnap);
  if (diff.length === 0) return null;
  return (
    <dl className="mt-2 grid gap-1 text-sm">
      {diff.map((d) => (
        <div key={d.label} className="flex justify-between gap-3">
          <dt className="text-muted">{d.label}</dt>
          <dd>
            <span className="text-muted line-through">{d.from}</span>
            {" → "}
            <b>{d.to}</b>
          </dd>
        </div>
      ))}
    </dl>
  );
}
function AssignForm({
  orderId, vehicles, drivers, orderClass, orderVolume, moveDate, busy, orderRef,
}: {
  orderId: number;
  vehicles: Array<{ id: number; plate: string; label: string; class: VehicleClass; capacity_m3: number; active: number }>;
  drivers: Array<{ id: number; name: string }>;
  orderClass: VehicleClass;
  orderVolume: number;
  moveDate: string;
  busy: Map<string, string>;
  orderRef: string;
}) {
  const suitable = vehicles.filter((v) => v.capacity_m3 >= orderVolume);
  return (
    <div className="mt-3 rounded-base border border-line bg-surface p-3">
      <p className="mb-2 text-sm font-semibold">Назначение машины и бригады</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {suitable.map((v) => {
          const takenBy = busy.get(`vehicle:${v.id}:${moveDate}`);
          return (
            <form key={v.id} action={async (fd) => {
              "use server";
              const r = await assignOrderAction({
                orderId,
                vehicleId: v.id,
                driverId: Number(fd.get("driverId")),
                codriverId: fd.get("codriverId") ? Number(fd.get("codriverId")) : null,
              });
              const errCode = r.error === "busy" ? "busy" : r.error === "codriver" ? "codriver" : r.message?.includes("правку") ? "pending" : r.error ?? "state";
              redirectMsg(r.ok ? "assigned" : errCode, orderRef);
            }} className="flex flex-wrap items-center gap-2 rounded-base border border-line bg-white p-2">
              <span className="text-sm">
                {v.plate} · {v.label} · {v.capacity_m3} м³ {takenBy && <span className="chip chip-delayed">занята ({takenBy})</span>}
              </span>
              <select name="driverId" className="input-base h-9 w-40" required aria-label="Водитель">
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select name="codriverId" className="input-base h-9 w-40" aria-label="Второй водитель">
                <option value="">— без второго —</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <SubmitButton>Назначить</SubmitButton>
            </form>
          );
        })}
        {suitable.length === 0 && <p className="text-sm text-danger">Нет свободных машин нужной вместимости ({orderVolume} м³, класс ≥ {orderClass}).</p>}
      </div>
    </div>
  );
}
