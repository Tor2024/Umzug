// Панель логиста (Э4, D5): список заявок, подтверждение, назначение с проверками.

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getDb, getTariffs, type DB } from "@/lib/db";
import { calculateQuote, recalculate, type QuoteSnapshot, type VehicleClass } from "@/lib/pricing";
import { tariffDrift } from "@/lib/ops";
import { confirmOrderAction, recalcOrderAction, cancelOrderAction, assignOrderAction, closeOrderAction, forceCloseOrderAction, assignSubcontractorAction, unassignSubcontractorAction, approveSpecialRequestsAction, rejectSpecialRequestsAction, autoAssignAction } from "@/lib/actions";
import RouteMapLazy from "@/components/route-map-lazy";
import CrewMapLazy from "@/components/crew-map-lazy";
import { SubmitButton } from "@/components/submit-button";
import { RevisionForm } from "@/components/revision-form";
import { RevisionDecision } from "@/components/revision-decision";
import { revisionFieldDiff } from "@/lib/revision";
import { ActionRequired, type ActionItem } from "@/components/action-required";
import { candidateVehicles, type CandidateVehicle } from "@/lib/dispatch-optimizer";
import { resolveRoute } from "@/lib/geo";

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
  confirmed: "chip chip-dispatched",
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
  client_phone: string | null;
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
  start_time: string;
  self_pack: number;
  special_requests: string | null;
  special_approved: number | null;
}

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Действующая (не отменённая/закрытая) бронь ресурсов на дату — для отображения конфликтов. */
async function busyMap(db: DB): Promise<Map<string, string>> {
  const res = await db.execute(
    `SELECT a.resource_type, a.resource_id, a.move_date, o.ref
     FROM assignments a JOIN orders o ON o.id = a.order_id
     WHERE o.status IN ('confirmed','assigned','enroute')`,
  );
  const rows = res.rows as unknown as Array<{ resource_type: string; resource_id: number; move_date: string; ref: string }>;
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
  sub_assigned: "Заявка передана партнёру-перевозчику.",
  sub_unassigned: "Партнёр снят — можно назначить свою машину.",
  spApproved: "Доп. требования клиента согласованы.",
  spRejected: "Доп. требования клиента отклонены.",
  sub_class: "Класс машин партнёра ниже класса заявки.",
  sub_error: "Не удалось передать партнёру.",
  autoAssigned: "Назначено автоматически: оптимальная машина + свободный экипаж.",
};

/** ref подставляется в текст баннера: «Готово: MS-2026-8941 — …». */
function bannerText(code: string, ref?: string): string {
  const base = ACTION_MSG[code] ?? code;
  if (!ref) return base;
  const okCodes = ["confirmed", "assigned", "closed", "force_closed", "cancelled", "recalculated", "sub_assigned", "sub_unassigned", "spApproved", "spRejected", "autoAssigned"];
  if (okCodes.includes(code)) return `${ref}: ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  return `${ref}: ${base}`;
}

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ status?: string; msg?: string; ref?: string }> }) {
  await connection();
  const user = await requireRole(["logist", "admin"], "/dispatch");
  const { status: statusFilter, msg, ref } = await searchParams;
  const db = await getDb();

  const rowsRes = await db.execute(
    `SELECT o.id, o.ref, o.status, o.contact_name, o.volume_m3, o.distance_km, o.move_date, o.gross_cents, o.vehicle_class, o.snapshot, o.from_text, o.to_text, o.pending_snapshot, o.revision_requested_by,
            o.start_time, o.self_pack, o.special_requests, o.special_approved,
            (SELECT phone FROM users WHERE id = o.client_id) AS client_phone
     FROM orders o WHERE o.status != 'cancelled'
     ORDER BY CASE WHEN o.status = 'new' THEN 0 ELSE 1 END, o.move_date ASC, o.id ASC
     LIMIT 200`,
  );
  const rows = rowsRes.rows as unknown as OrderRow[];

  const filtered = statusFilter && statusFilter !== "all" ? rows.filter((r) => r.status === statusFilter) : rows;

  const vehiclesRes = await db.execute("SELECT id, plate, label, class, capacity_m3, active, home_base, current_location FROM vehicles WHERE active = 1 ORDER BY capacity_m3");
  const vehicles = vehiclesRes.rows as unknown as
    Array<{ id: number; plate: string; label: string; class: VehicleClass; capacity_m3: number; active: number; home_base: string; current_location: string }>;
  const driversRes = await db.execute("SELECT id, name FROM users WHERE role = 'driver' AND active = 1 ORDER BY name");
  const drivers = driversRes.rows as unknown as
    Array<{ id: number; name: string }>;

  const busy = await busyMap(db);
  const tariffs = await getTariffs(db); // D8.7/Э7: дрифт относительно ТЕКУЩИХ тарифов

  // D11: сводка ближайших дней (5 дней) — заказы/машины/водители/заявки в очереди
  const { todayIsoBerlin, resourceBookings, dayAvailability } = await import("@/lib/availability");
  const today = todayIsoBerlin();
  const summary = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const rb = await resourceBookings(db, iso);
    const av = await dayAvailability(db, iso, {});
    summary.push({ iso, orders: rb.busyVehicleIds.length, pending: rb.pendingOrders, freeV: av.freeSuitable, freeD: av.freeDrivers, maxV: av.maxVehicles, maxD: av.maxDrivers, status: av.status });
  }

  // Геометрия маршрутов одним запросом (вместо per-row .get в цикле)
  const geometryMap = new Map<number, [number, number][] | null>();
  {
    const routeRes = await db.execute(
      "SELECT order_id, geometry FROM route WHERE order_id IN (SELECT id FROM orders WHERE status != 'cancelled' AND status != 'new')",
    );
    for (const r of routeRes.rows as unknown as Array<{ order_id: number; geometry: string | null }>) {
      geometryMap.set(Number(r.order_id), r.geometry ? (JSON.parse(r.geometry) as [number, number][]) : null);
    }
  }

  // №9: последние чек-поинты рейсов одним запросом — карточка «Где экипаж» для enroute
  const CP_LABEL: Record<string, string> = {
    departed: "Выехал",
    arrived_load: "На погрузке",
    loaded: "Груз погружен",
    arrived_unload: "На выгрузке",
    done: "Переезд выполнен",
  };
  const lastCpMap = new Map<number, { cp: string; at: number; lat: number | null; lon: number | null }>();
  {
    const cpRes = await db.execute(
      "SELECT order_id, cp, created_at AS at, lat, lon FROM trip_checkpoints WHERE order_id IN (SELECT id FROM orders WHERE status = 'enroute') ORDER BY created_at",
    );
    for (const r of cpRes.rows as unknown as Array<{ order_id: number; cp: string; at: number; lat: number | null; lon: number | null }>) {
      lastCpMap.set(Number(r.order_id), { cp: r.cp, at: Number(r.at), lat: r.lat, lon: r.lon });
    }
  }

  // ── Панель «Требует вашего действия»: незаконченные операции логиста ──
  const dispatchActions: ActionItem[] = [];
  // 48ч-фокус (@1922): заявка-«новая» с датой переезда в ближайшие 48 часов — срочная
  const in48h = (d: string): boolean => d > today && d <= addDaysIso(today, 2);
  function addDaysIso(iso: string, n: number): string {
    const x = new Date(iso + "T12:00:00Z");
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  }
  for (const o of rows) {
    if (o.status === "new") {
      dispatchActions.push({
        key: `conf-${o.ref}`,
        label: in48h(o.move_date) ? "Подтвердить цену и заявку — до переезда ≤48 ч" : "Подтвердить цену и заявку",
        href: `/dispatch?status=new`,
        tag: o.ref,
        urgent: o.move_date <= addDaysIso(today, 2),
      });
    } else if (o.status === "confirmed") {
      dispatchActions.push({ key: `asg-${o.ref}`, label: "Назначить машину и водителей", href: `/dispatch?status=confirmed`, tag: o.ref, urgent: o.move_date <= addDaysIso(today, 2) });
    } else if (o.status === "enroute") {
      // зависшая приёмка: протокол подписан, клиент не подтвердил; или рейс начат давно
      dispatchActions.push({ key: `enr-${o.ref}`, label: "Рейс в пути — ждём протокол/приёмку", href: `/order/${o.ref}`, tag: o.ref, urgent: o.move_date <= today });
    }
  }

  // Умный подбор (требование @1480@): для confirmed-заказов считаем холостой пробег подачи
  // каждой свободной машины (current_location → адрес забора) и ранжируем — только для них, не для всех 200.
  const candidatesMap = new Map<number, CandidateVehicle[]>();
  for (const o of filtered) {
    if (o.status === "confirmed") {
      candidatesMap.set(o.id, await candidateVehicles(db, o.id, o.move_date, o.from_text));
    }
  }

  // ── Возврат машины на базу (@1641): видимость диспетчеру ──
  // Для assigned-заказов СВОЕЙ машиной: расстояние выгрузка → база машины +
  // есть ли следующий заказ в этом городе (тогда возврат не требуется).
  const cityOfText = (q: string): string => {
    const parts = q.split(",").map((p) => p.trim()).filter(Boolean);
    return parts.length >= 2 ? (parts[parts.length - 1] ?? "") : "";
  };
  const returnInfoMap = new Map<number, { km: number | null; costCents: number | null; hasNextOrder: boolean }>();
  {
    const asgRes = await db.execute(
      `SELECT a.order_id, v.home_base
       FROM assignments a JOIN vehicles v ON v.id = a.resource_id
       WHERE a.resource_type = 'vehicle'
         AND a.order_id IN (SELECT id FROM orders WHERE status = 'assigned')`,
    );
    const asgRows = asgRes.rows as unknown as Array<{ order_id: number; home_base: string }>;
    // Города будущих заборов (для проверки «рядом есть следующий заказ»)
    const futureRes = await db.execute(
      `SELECT id, from_text FROM orders
       WHERE status IN ('new','confirmed','assigned') AND move_date >= date('now')`,
    );
    const futureRows = futureRes.rows as unknown as Array<{ id: number; from_text: string }>;
    const assignedById = new Map(asgRows.map((r) => [Number(r.order_id), r]));
    for (const o of filtered) {
      if (o.status !== "assigned") continue;
      const asg = assignedById.get(o.id);
      if (!asg || !asg.home_base) continue;
      const destCity = cityOfText(o.to_text);
      const hasNextOrder = futureRows.some(
        (f) => f.id !== o.id && destCity !== "" && cityOfText(f.from_text) === destCity,
      );
      let km: number | null = null;
      try {
        const rr = await resolveRoute(o.to_text, asg.home_base, "");
        if (rr && !rr.error && rr.km > 0) km = rr.km;
      } catch { /* гео-сервис недоступен — km остаётся null */ }
      const costCents = km != null ? Math.round(km * 104) : null; // APPROACH_COST_PER_KM_CENTS
      returnInfoMap.set(o.id, { km, costCents, hasNextOrder });
    }
  }

  // Субподрядчики (@1480@): активные партнёры + назначение по заказам
  const subsRes = await db.execute("SELECT id, name, class, price_mode, price_cents FROM subcontractors WHERE active = 1 ORDER BY name");
  const subs = subsRes.rows as unknown as
    Array<{ id: number; name: string; class: VehicleClass; price_mode: "per_km" | "per_order" | "per_day"; price_cents: number }>;
  const subAssignMap = new Map<number, { name: string; cost_cents: number }>();
  {
    const saRes = await db.execute(
      `SELECT os.order_id, os.cost_cents, s.name
       FROM order_subcontractors os JOIN subcontractors s ON s.id = os.sub_id
       WHERE os.order_id IN (SELECT id FROM orders WHERE status != 'cancelled')`,
    );
    for (const r of saRes.rows as unknown as Array<{ order_id: number; cost_cents: number; name: string }>) {
      subAssignMap.set(Number(r.order_id), { name: r.name, cost_cents: Number(r.cost_cents) });
    }
  }

  return (
    <>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Панель логиста</h1>
          <p className="text-muted">{user.name} · новых заявок: {rows.filter((r) => r.status === "new").length} · <Link className="text-accent underline" href="/inbox">Сообщения →</Link></p>
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

      <ActionRequired items={dispatchActions} title="Заявки, требующие действий" />

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
          const routeRow = geometryMap.get(o.id);
          const geometry = routeRow ?? null;
          // D10: активная правка
          const pendingSnap = o.pending_snapshot ? (JSON.parse(o.pending_snapshot) as QuoteSnapshot) : null;

          return (
            <section key={o.id} className="card p-5" data-order-ref={o.ref}>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/order/${o.ref}`} className="font-bold text-primary underline-offset-2 hover:underline">{o.ref}</Link>
                <span className={CHIP_CLASS[o.status]}>{STATUS_LABEL[o.status]}</span>
                <span className="chip chip-neutral">Класс {o.vehicle_class}</span>
                {needsSecond && <span className="chip chip-delayed">Смена &gt;10 ч — нужен 2-й водитель</span>}
                {/* Возврат машины на базу (@1641): акцент для диспетчера */}
                {(() => {
                  const ri = returnInfoMap.get(o.id);
                  if (o.status !== "assigned") return null;
                  if (ri?.hasNextOrder) return <span className="chip chip-trust">Есть следующий заказ в этом городе — возврат не требуется</span>;
                  if (ri?.km != null) return <span className="chip chip-delayed">Возврат на базу: {ri.km} км · себестоимость {((ri.costCents ?? 0) / 100).toFixed(2)} € (внутр.)</span>;
                  return <span className="chip chip-neutral">Возврат на базу: не рассчитан</span>;
                })()}
                {o.start_time && <span className="chip chip-neutral">Начало: {o.start_time}</span>}
                {!!o.self_pack && <span className="chip chip-neutral">Упаковка — сам клиент</span>}
                {o.special_requests && (
                  <span className={`chip ${o.special_approved === 1 ? "chip-trust" : o.special_approved === 0 ? "chip-delayed" : "chip-dispatched"}`}>
                    {o.special_approved === 1 ? "Требования согласованы" : o.special_approved === 0 ? "Требования отклонены" : "Требования ждут согласования"}
                  </span>
                )}
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
              {o.client_phone && (
                <p className="mt-1 text-sm">
                  Tel: <a className="underline" href={`tel:${o.client_phone.replace(/\s/g, "")}`}>{o.client_phone}</a>
                </p>
              )}
              {/* Таймлайн рейса (@2048 п.1): расписание от подачи до возврата на базу */}
              {o.status === "assigned" && (() => {
                const q = (() => { try { return recalculate(snap); } catch { return null; } })();
                if (!q) return null;
                const approach = candidatesMap.get(o.id)?.find((c) => c.optimal)?.approachMin ?? 0;
                const fmtT = (m: number): string => {
                  const [h, mm] = (o.start_time || "08:00").split(":").map(Number);
                  const total = h * 60 + mm + Math.round(m);
                  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
                };
                const load = q.crewHoursLoad * 60, drive = q.crewHoursDrive * 60, unload = load;
                const retKm = snap.config.returnKm ?? 0;
                return (
                  <div className="mt-3 rounded-base border border-line bg-surface p-3 text-sm">
                    <p className="font-semibold">Расписание дня <span className="font-normal text-muted">(расчётное; возможны задержки — буфер закладывает логист при правке цены)</span></p>
                    <ul className="mt-1 space-y-0.5 text-muted">
                      <li>{fmtT(0)} — подача машины ({Math.round(approach)} мин)</li>
                      <li>{fmtT(approach)} — начало погрузки ({Math.round(load / 60 * 10) / 10} ч)</li>
                      <li>{fmtT(approach + load)} — выезд в путь ({Math.round(drive / 60 * 10) / 10} ч)</li>
                      <li>{fmtT(approach + load + drive)} — прибытие, выгрузка ({Math.round(unload / 60 * 10) / 10} ч)</li>
                      <li>{fmtT(approach + load + drive + unload)} — готово{retKm > 0 ? ` · возврат на базу ${retKm} км (~${Math.round(retKm / 80 * 10) / 10} ч)` : ""}</li>
                    </ul>
                  </div>
                );
              })()}
              {/* №9: «Где экипаж» — последний чек-поинт + карта позиции (только enroute) */}
              {o.status === "enroute" && (() => {
                const cp = lastCpMap.get(o.id);
                if (!cp) return null;
                const cpLabel = CP_LABEL[cp.cp] ?? cp.cp;
                const hasGeo = cp.lat != null && cp.lon != null;
                return (
                  <div className="mt-3 rounded-base border border-trust/30 bg-emerald-50 p-3 text-sm">
                    <p className="font-semibold">Где экипаж</p>
                    <p className="mt-1">
                      <span className="chip chip-trust">{cpLabel}</span>
                      {" · "}
                      <span className="text-muted">{new Date(cp.at * 1000).toLocaleString("de-DE")}</span>
                      {!hasGeo && <span className="ml-1 text-xs text-muted">(отметка без координат)</span>}
                    </p>
                    {hasGeo && (
                      <div className="mt-2">
                        <CrewMapLazy
                          geometry={geometryMap.get(o.id) ?? null}
                          crew={{ lat: cp.lat!, lon: cp.lon!, at: cp.at, cpLabel }}
                          fromText={o.from_text}
                          toText={o.to_text}
                          height={220}
                        />
                      </div>
                    )}
                    <p className="mt-1 text-xs text-muted">Водитель отмечает этапы со смартфона — координаты сохраняются в момент отметки. Обновите страницу, чтобы увидеть свежую позицию.</p>
                  </div>
                );
              })()}
              {o.special_requests && (
                <div className="mt-3 rounded-base border border-accent-soft bg-orange-50 p-3 text-sm">
                  <p className="font-semibold">Доп. требования клиента к загрузке/выгрузке:</p>
                  <p className="mt-1 whitespace-pre-wrap">{o.special_requests}</p>
                  {o.special_approved === null && (o.status === "new" || o.status === "confirmed") && (
                    <div className="mt-2 flex gap-2">
                      <form action={async () => { "use server"; const r = await approveSpecialRequestsAction(o.id); redirectMsg(r.ok ? "spApproved" : r.message ?? "state", o.ref); }}>
                        <SubmitButton className="btn btn-primary h-9">Согласовать</SubmitButton>
                      </form>
                      <form action={async () => { "use server"; const r = await rejectSpecialRequestsAction(o.id); redirectMsg(r.ok ? "spRejected" : r.message ?? "state", o.ref); }}>
                        <SubmitButton className="btn btn-outline h-9">Отклонить</SubmitButton>
                      </form>
                    </div>
                  )}
                  {o.special_approved === 0 && <p className="mt-1 text-xs text-danger">Отклонено — обсудите с клиентом в переписке.</p>}
                </div>
              )}
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
                <div className="mt-3">
                  <form action={async () => { "use server"; const r = await autoAssignAction(o.id); redirectMsg(r.ok ? "autoAssigned" : r.message ?? "state", o.ref); }} className="mb-3">
                    <SubmitButton className="btn btn-secondary">⚡ Назначить автоматически <span className="font-normal text-muted">(оптимальная машина + свободный экипаж)</span></SubmitButton>
                  </form>
                  <AssignForm
                  orderId={o.id}
                  vehicles={vehicles}
                  candidates={candidatesMap.get(o.id) ?? []}
                  drivers={drivers}
                  orderClass={o.vehicle_class}
                  orderVolume={o.volume_m3}
                  moveDate={o.move_date}
                  busy={busy}
                  orderRef={o.ref}
                  />
                </div>
              )}

              {/* Отдать партнёру (субподрядчик) — только для confirmed/assigned без правки */}
              {(o.status === "confirmed" || o.status === "assigned") && !pendingSnap && (
                <div className="mt-3 rounded-base border border-line bg-surface p-3">
                  <p className="mb-2 text-sm font-semibold">Отдать партнёру <span className="font-normal text-muted">— сторонний перевозчик; маржа = цена клиента − стоимость партнёра</span></p>
                  {subAssignMap.get(o.id) ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="chip chip-dispatched">Партнёр: {subAssignMap.get(o.id)!.name}</span>
                      <span className="text-muted">стоимость {(subAssignMap.get(o.id)!.cost_cents / 100).toFixed(2)} € · маржа {(o.gross_cents - subAssignMap.get(o.id)!.cost_cents) / 100 >= 0 ? "+" : ""}{((o.gross_cents - subAssignMap.get(o.id)!.cost_cents) / 100).toFixed(2)} €</span>
                      <form action={async () => { "use server"; const r = await unassignSubcontractorAction(o.id); redirectMsg(r.ok ? "sub_unassigned" : r.message?.includes("изменён") ? "state" : "sub_error", o.ref); }}>
                        <SubmitButton className="btn btn-outline">Снять партнёра</SubmitButton>
                      </form>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-end gap-2">
                      {subs.filter((s) => s.class !== undefined).map((s) => {
                        const cost = s.price_mode === "per_km"
                          ? Math.round(o.distance_km * s.price_cents)
                          : s.price_cents;
                        const margin = o.gross_cents - cost;
                        return (
                          <form key={s.id} action={async () => { "use server"; const r = await assignSubcontractorAction(o.id, s.id); redirectMsg(r.ok ? "sub_assigned" : r.message?.includes("ниже") ? "sub_class" : "sub_error", o.ref); }} className="flex flex-wrap items-center gap-2 rounded-base border border-line bg-white p-2 text-sm">
                            <span>
                              <b>{s.name}</b> · класс {s.class} ·{" "}
                              {s.price_mode === "per_km" ? `${(s.price_cents / 100).toFixed(2)} €/км × ${o.distance_km} км` : s.price_mode === "per_day" ? `${(s.price_cents / 100).toFixed(2)} €/день` : `${(s.price_cents / 100).toFixed(2)} €/заказ`}
                              {" "}→ стоимость <b>{(cost / 100).toFixed(2)} €</b>, маржа <span className={margin >= 0 ? "text-trust" : "text-danger"}>{margin >= 0 ? "+" : ""}{(margin / 100).toFixed(2)} €</span>
                            </span>
                            <SubmitButton className="btn btn-secondary">Передать</SubmitButton>
                          </form>
                        );
                      })}
                      {subs.length === 0 && <p className="text-sm text-muted">Активных партнёров нет — добавьте в админ-панели.</p>}
                    </div>
                  )}
                </div>
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
    </>
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
function redirectMsg(code: string, ref?: string): never {
  redirect(`/dispatch?msg=${code}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`);
  throw new Error("unreachable");
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
  orderId, vehicles, candidates, drivers, orderClass, orderVolume, moveDate, busy, orderRef,
}: {
  orderId: number;
  vehicles: Array<{ id: number; plate: string; label: string; class: VehicleClass; capacity_m3: number; active: number; home_base: string; current_location: string }>;
  candidates: CandidateVehicle[];
  drivers: Array<{ id: number; name: string }>;
  orderClass: VehicleClass;
  orderVolume: number;
  moveDate: string;
  busy: Map<string, string>;
  orderRef: string;
}) {
  // Класс A<B<C: машина не ниже оплаченного класса И вместимость ≥ объёма заказа (D5.6, как в assignOrder).
  const CLASS_RANK: Record<VehicleClass, number> = { A: 1, B: 2, C: 3 };
  const suitable = vehicles.filter(
    (v) => v.capacity_m3 >= orderVolume && CLASS_RANK[v.class] >= CLASS_RANK[orderClass],
  );
  const candById = new Map(candidates.map((c) => [c.id, c]));
  // Занятость водителя на дату переезда — пометка в select (конфликт сервер всё равно ловит).
  const driverBusy = (id: number) => busy.get(`driver:${id}:${moveDate}`);
  return (
    <div className="mt-3 rounded-base border border-line bg-surface p-3">
      <p className="mb-2 text-sm font-semibold">Назначение машины и бригады <span className="font-normal text-muted">— машины отсортированы по холостому пробегу подачи (★ оптимальная)</span></p>
      <div className="grid gap-2 sm:grid-cols-2">
        {suitable
          .slice()
          .sort((a, b) => (candById.get(a.id)?.score ?? Number.MAX_SAFE_INTEGER) - (candById.get(b.id)?.score ?? Number.MAX_SAFE_INTEGER))
          .map((v) => {
          const takenBy = busy.get(`vehicle:${v.id}:${moveDate}`);
          const cand = candById.get(v.id);
          const loc = cand?.currentLocation || v.current_location || v.home_base;
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
                {cand?.optimal && <span className="chip chip-transit">★ оптимальная</span>}{" "}
                {v.plate} · {v.label} · {v.capacity_m3} м³ {takenBy && <span className="chip chip-delayed">занята ({takenBy})</span>}
              </span>
              <span className="block w-full text-xs text-muted">
                Место: {loc || "—"}
                {cand?.approachKm != null && <> · подача {cand.approachKm.toFixed(1)} км / {cand.approachMin} мин · себестоимость подачи {(cand.approachCostCents! / 100).toFixed(2)} € (внутр.)</>}
                {cand && cand.approachKm === null && <> · подача: не рассчитана</>}
              </span>
              <select name="driverId" className="input-base h-9 w-40" required aria-label="Водитель">
                {drivers.map((d) => {
                  const b = driverBusy(d.id);
                  return <option key={d.id} value={d.id}>{d.name}{b ? ` — занят (${b})` : ""}</option>;
                })}
              </select>
              <select name="codriverId" className="input-base h-9 w-40" aria-label="Второй водитель">
                <option value="">— без второго —</option>
                {drivers.map((d) => {
                  const b = driverBusy(d.id);
                  return <option key={d.id} value={d.id}>{d.name}{b ? ` — занят (${b})` : ""}</option>;
                })}
              </select>
              <SubmitButton>Назначить</SubmitButton>
            </form>
          );
        })}
        {suitable.length === 0 && <p className="text-sm text-danger">Нет машин нужной вместимости ({orderVolume} м³) и класса ≥ {orderClass}.</p>}
      </div>
    </div>
  );
}
