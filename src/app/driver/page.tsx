// Экран водителя (Э5, D6): рейсы водителя, кнопка «Выехал», чек-лист + протокол.
// Мобильный-first: крупные touch-цели, один шаг дня на экран.

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb, verifyChain, type ProtocolRow } from "@/lib/db";
import { recalculate, type QuoteSnapshot } from "@/lib/pricing";
import { DriverChecklist } from "@/components/driver-checklist";
import RouteMapLazy from "@/components/route-map-lazy";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Экран водителя", robots: { index: false } };
export const instant = false;

const STATUS_LABEL: Record<string, string> = {
  new: "Новая заявка",
  confirmed: "Подтверждена",
  assigned: "Назначена",
  enroute: "В пути",
  acceptance: "Приёмка",
  closed: "Закрыт",
  cancelled: "Отменён",
};

function fmt(cents: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(iso + "T12:00:00"));
}

export default async function DriverPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await connection();
  const user = await requireRole(["driver", "admin"], "/driver");
  const { msg } = await searchParams;

  const db = await getDb();
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // D6.8: рейсы водителя через assignments, сегодня сверху + предстоящие
  const rowsRes = await db.execute({
    sql: `SELECT o.id, o.ref, o.status, o.move_date, o.from_text, o.to_text, o.volume_m3, o.distance_km,
            o.gross_cents, o.snapshot, t.vehicle_id, t.driver_id, t.codriver_id, v.plate, v.label AS vehicle_label
     FROM trips t
     JOIN orders o ON o.id = t.order_id
     JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.driver_id = ? OR t.codriver_id = ?
     ORDER BY CASE WHEN o.status IN ('assigned','enroute') THEN 0 ELSE 1 END, o.move_date ASC, o.id ASC
     LIMIT 50`,
    args: [user.id, user.id],
  });
  const rows = rowsRes.rows as unknown as Array<{
    id: number; ref: string; status: string; move_date: string; from_text: string; to_text: string;
    volume_m3: number; distance_km: number; gross_cents: number; snapshot: string;
    vehicle_id: number; driver_id: number; codriver_id: number | null; plate: string; vehicle_label: string;
  }>;

  const chain = await verifyChain(db);

  // Предвыборка: протоколы, геометрия, имена водителей, позиции чек-листа (вместо per-row запросов)
  const orderIds = rows.map((r) => r.id);
  const protoMap = new Map<number, ProtocolRow>();
  const geometryMap = new Map<number, [number, number][] | null>();
  const nameMap = new Map<number, string>();
  const planMap = new Map<number, Array<{ key: string; label: string }>>();
  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => "?").join(",");
    const protoRes = await db.execute({
      sql: `SELECT id, order_id, loaded_json, deviation_m3, notes, signature, hash, signed_at FROM protocol WHERE order_id IN (${placeholders})`,
      args: orderIds,
    });
    for (const p of protoRes.rows as unknown as Array<ProtocolRow & { order_id: number }>) {
      protoMap.set(Number(p.order_id), p);
    }
    const routeRes = await db.execute({
      sql: `SELECT order_id, geometry FROM route WHERE order_id IN (${placeholders})`,
      args: orderIds,
    });
    for (const r of routeRes.rows as unknown as Array<{ order_id: number; geometry: string | null }>) {
      geometryMap.set(Number(r.order_id), r.geometry ? (JSON.parse(r.geometry) as [number, number][]) : null);
    }
    const planRes = await db.execute({
      sql: `SELECT order_id, key, label FROM order_lines WHERE order_id IN (${placeholders}) AND kind = 'line' ORDER BY order_id, idx`,
      args: orderIds,
    });
    for (const l of planRes.rows as unknown as Array<{ order_id: number; key: string; label: string }>) {
      const arr = planMap.get(Number(l.order_id)) ?? [];
      arr.push({ key: l.key, label: l.label });
      planMap.set(Number(l.order_id), arr);
    }
  }
  {
    const driverIds = Array.from(new Set(rows.flatMap((r) => [Number(r.driver_id), ...(r.codriver_id ? [Number(r.codriver_id)] : [])])));
    if (driverIds.length > 0) {
      const nameRes = await db.execute({
        sql: `SELECT id, name FROM users WHERE id IN (${driverIds.map(() => "?").join(",")})`,
        args: driverIds,
      });
      for (const n of nameRes.rows as unknown as Array<{ id: number; name: string }>) {
        nameMap.set(Number(n.id), n.name);
      }
    }
  }
  const driverName = (id: number): string => nameMap.get(id) ?? `#${id}`;

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <h1 className="mb-1 text-2xl font-bold">Мой день</h1>
      <p className="mb-6 text-sm text-muted">{user.name} · {todayIso}</p>

      {msg && (
        <div className="mb-4 rounded-base border border-danger/30 bg-red-50 p-3 text-sm" role="status" aria-live="polite">
          {msg}
        </div>
      )}

      {rows.length === 0 && (
        <div className="card p-6 text-sm text-muted">
          Рейсов пока нет. Назначение появится здесь, когда логист распределит машину.
        </div>
      )}

      <ul className="grid gap-4">
        {rows.map((r) => {
          const snap = JSON.parse(r.snapshot) as QuoteSnapshot;
          const needsSecond = (() => { try { return recalculate(snap).needsSecondDriver; } catch { return false; } })();
          const isToday = r.move_date === todayIso;
          const tomorrowIso = (() => { const d = new Date(todayIso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
          const isTomorrow = r.move_date === tomorrowIso && r.status === "assigned";
          const isActive = r.status === "assigned" || r.status === "enroute";
          const proto = protoMap.get(r.id);
          const routeRow = geometryMap.get(r.id);
          const geometry = routeRow ?? null;

          return (
            <li key={r.ref} className={`card p-5 ${isActive ? "border-accent" : ""}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Link className="font-semibold text-accent hover:underline" href={`/order/${r.ref}`}>{r.ref}</Link>
                <span className="chip chip-transit">{STATUS_LABEL[r.status] ?? r.status}</span>
                {isToday && isActive && <span className="chip chip-dispatched">Сегодня</span>}
                {isTomorrow && <span className="chip chip-neutral">Завтра: {r.ref}</span>}
                {needsSecond && <span className="chip">2-й водитель</span>}
              </div>
              <p className="text-sm font-medium">{r.from_text} → {r.to_text}</p>
              <p className="mt-1 text-sm text-muted">
                {dateLabel(r.move_date)} · {r.volume_m3} м³ · {r.distance_km} км · {r.plate} ({r.vehicle_label}) · {fmt(r.gross_cents)}
              </p>
              {geometry && <div className="mt-3"><RouteMapLazy geometry={geometry} fromText={r.from_text} toText={r.to_text} height={200} /></div>}
              {r.codriver_id && (
                <p className="text-sm text-muted">Экипаж: {driverName(r.driver_id)}{r.codriver_id !== r.driver_id ? ` + ${driverName(r.codriver_id)}` : ""}</p>
              )}

              {/* Шаг дня 1: Выехал (assigned→enroute, только сегодня — D6.3) */}
              {r.status === "assigned" && (
                isToday ? (
                  <StartRouteForm orderId={r.id} />
                ) : (
                  <p className="mt-3 rounded-container bg-surface-2 px-3 py-2 text-xs font-medium text-ink">
                    Выезд возможен только в день переезда ({dateLabel(r.move_date)}).
                  </p>
                )
              )}

              {/* Шаг дня 2: чек-лист + протокол (только enroute, D6.1) */}
              {r.status === "enroute" && !proto && (
                <DriverChecklist
                  orderId={r.id}
                  planM3={r.volume_m3}
                  items={planMap.get(r.id) ?? []}
                />
              )}

              {/* Шаг дня 3: протокол подписан — только просмотр (D6.1 append-only) */}
              {proto && (
                <div className="mt-3 rounded-container border border-line bg-surface px-4 py-3 text-sm">
                  <p className="font-semibold">Протокол подписан</p>
                  <p className="text-muted">
                    План {JSON.parse(proto.loaded_json).plan_m3} м³ → факт {JSON.parse(proto.loaded_json).fact_m3} м³ ·
                    {" "}Отклонение {proto.deviation_m3 > 0 ? "+" : ""}{proto.deviation_m3} м³
                  </p>
                  {proto.notes && <p className="text-muted">Заметки: {proto.notes}</p>}
                  <p className="mt-1 text-xs text-muted">Подпись: {proto.signature}</p>
                  <p className="text-xs text-muted">Хеш: <span className="font-mono">{proto.hash.slice(0, 16)}…</span></p>
                  <a className="btn btn-outline mt-2 inline-block px-3 py-1.5 text-sm" href={`/api/pdf/protocol/${r.ref}`} target="_blank" rel="noopener">Протокол (PDF)</a>
                </div>
              )}

              {/* Статусы после протокола: клиент подтверждает приёмку, логист закрывает */}
              {r.status === "acceptance" && (
                <p className="mt-3 text-sm text-muted">Рейс завершён — клиент подтверждает приёмку.</p>
              )}
              {r.status === "closed" && <p className="mt-3 text-sm text-trust">Рейс закрыт.</p>}
            </li>
          );
        })}
      </ul>

      <p className="mt-8 text-xs text-muted">
        Цепочка протоколов: {chain.valid ? "валидна" : `НАРУШЕНА (звено ${chain.brokenAt})`} · {chain.count} протоколов
      </p>
      <DashLink />
    </main>
  );
}

function StartRouteForm({ orderId }: { orderId: number }) {
  return (
    <form action={`/api/driver/start/${orderId}`} method="post" className="mt-3">
      <SubmitButton className="btn btn-primary w-full text-base">Выехал</SubmitButton>
    </form>
  );
}

function DashLink() {
  return <Link className="mt-3 inline-block text-sm text-accent hover:underline" href="/account">В личный кабинет</Link>;
}
