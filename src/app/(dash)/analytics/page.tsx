// Аналитика (задача 7): выручка, загрузка, маржинальность.
// Источники: payments (денежная правда, D2), orders (объёмы/даты), snapshots (себестоимость экипажа).
// Маржа = выручка − себестоимость экипажа (crew line из snapshot.quote.lines, key "crew").

import { connection } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { Metadata } from "next";

export const instant = false;
export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Аналитика" };

const EUR = (cents: number): string =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "EUR" }).format(cents / 100);
const PCT = (x: number): string => `${(x * 100).toFixed(1)} %`;

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

type SnapshotLite = {
  quote: { lines: Array<{ key: string; amount: number }>; workHours: number };
};

export default async function AnalyticsPage() {
  await connection();
  const user = await requireRole(["finance", "admin"], "/analytics");
  const db = await getDb();

  // --- 1. Выручка по месяцам: payments (поступления и возвраты) ---
  // paid_at хранится как unix-секунды → дату месяца берём в Europe/Berlin через datetime(ts,'unixepoch','weekday 0','-N days'...);
  // проще: группировка по дате Берлина: datetime(p.paid_at, 'unixepoch', '+1 hour') даёт берлинское время круглый год только зимой.
  // Для демо допустимо: используем datetime(..., 'unixepoch') → UTC (разница с Берлином ≤ 2ч, на границе месяца редкий сдвиг).
  const monthRes = await db.execute(
    `SELECT substr(datetime(p.paid_at, 'unixepoch'), 1, 7) AS month,
            SUM(CASE WHEN p.amount_cents > 0 THEN p.amount_cents ELSE 0 END) AS revenue,
            SUM(CASE WHEN p.amount_cents < 0 THEN -p.amount_cents ELSE 0 END) AS refunds
       FROM payments p
      GROUP BY month ORDER BY month DESC LIMIT 12`,
  );
  const months = monthRes.rows as unknown as Array<{ month: string; revenue: number; refunds: number }>;

  // --- 2. Заказы по месяцам (move_date, не cancelled) ---
  const ordersRes = await db.execute(
    `SELECT substr(move_date, 1, 7) AS month,
            COUNT(*) AS cnt,
            SUM(gross_cents) AS gross,
            SUM(volume_m3) AS volume
       FROM orders
      WHERE status NOT IN ('cancelled')
      GROUP BY month ORDER BY month DESC LIMIT 12`,
  );
  const orderMonths = ordersRes.rows as unknown as Array<{ month: string; cnt: number; gross: number; volume: number }>;
  const orderByMonth = new Map(orderMonths.map((r) => [r.month, r]));

  // --- 3. Себестоимость экипажа из снимков закрытых заказов (маржинальность) ---
  const closedRes = await db.execute(
    `SELECT snapshot, gross_cents, ref FROM orders WHERE status = 'closed'`,
  );
  const closed = closedRes.rows as unknown as Array<{ snapshot: string; gross_cents: number; ref: string }>;

  let crewCostTotal = 0;
  let closedGrossTotal = 0;
  let totalHours = 0;
  for (const o of closed) {
    try {
      const snap = JSON.parse(o.snapshot) as SnapshotLite;
      const crew = snap.quote?.lines?.find((l) => l.key === "crew");
      if (crew) crewCostTotal += crew.amount;
      totalHours += snap.quote?.workHours ?? 0;
      closedGrossTotal += o.gross_cents;
    } catch {
      // повреждённый снимок — пропускаем
    }
  }
  const marginTotal = closedGrossTotal - crewCostTotal;
  const marginPct = closedGrossTotal > 0 ? marginTotal / closedGrossTotal : 0;
  const avgCheck = closed.length > 0 ? Math.round(closedGrossTotal / closed.length) : 0;
  const costPct = closedGrossTotal > 0 ? crewCostTotal / closedGrossTotal : 0;

  // Выплаты партнёрам по закрытым заказам (субподрядчики, @1480@) → реальная маржа
  const subCostRes = await db.execute(
    `SELECT COALESCE(SUM(os.cost_cents),0) AS s
       FROM order_subcontractors os JOIN orders o ON o.id = os.order_id
      WHERE o.status = 'closed'`,
  );
  const subCostTotal = Number((subCostRes.rows[0] as unknown as { s: number }).s);
  const realMarginTotal = marginTotal - subCostTotal;
  const realMarginPct = closedGrossTotal > 0 ? realMarginTotal / closedGrossTotal : 0;

  // --- 4. Загрузка машин: trips по датам за последние 60 дней + потенциал ---
  const fleetRes = await db.execute("SELECT COUNT(*) AS n FROM vehicles WHERE active = 1");
  const fleetSize = Number((fleetRes.rows[0] as unknown as { n: number }).n);

  const tripRes = await db.execute(
    `SELECT move_date, COUNT(*) AS trips FROM trips
      WHERE move_date >= date('now', '-60 days')
      GROUP BY move_date ORDER BY move_date DESC LIMIT 60`,
  );
  const tripDays = tripRes.rows as unknown as Array<{ move_date: string; trips: number }>;
  // уникальные машины в день (заказ может занимать несколько машин)
  const vehRes = await db.execute(
    `SELECT move_date, COUNT(DISTINCT vehicle_id) AS vehicles FROM trips
      WHERE move_date >= date('now', '-60 days')
      GROUP BY move_date ORDER BY move_date DESC LIMIT 60`,
  );
  const vehDays = vehRes.rows as unknown as Array<{ move_date: string; vehicles: number }>;
  const vehByDate = new Map(vehDays.map((r) => [r.move_date, Number(r.vehicles)]));

  const busyDays = tripDays.length;
  const totalVehDays = [...vehByDate.values()].reduce((s, v) => s + v, 0);
  const utilization = busyDays > 0 && fleetSize > 0 ? totalVehDays / (busyDays * fleetSize) : 0;

  // --- 5. Воронка статусов ---
  const statusRes = await db.execute(
    `SELECT status, COUNT(*) AS n FROM orders GROUP BY status`,
  );
  const statusCounts = statusRes.rows as unknown as Array<{ status: string; n: number }>;
  const STATUS_LABEL: Record<string, string> = {
    new: "Новые", confirmed: "Подтверждены", assigned: "Назначены", enroute: "В пути",
    acceptance: "Приёмка", closed: "Закрыты", cancelled: "Отменены",
  };
  const totalOrders = statusCounts.reduce((s, r) => s + Number(r.n), 0);
  const cancelled = Number(statusCounts.find((r) => r.status === "cancelled")?.n ?? 0);
  const cancelRate = totalOrders > 0 ? cancelled / totalOrders : 0;

  const monthLabel = (m: string): string => {
    const [y, mm] = m.split("-");
    return `${MONTHS[Number(mm) - 1]} ${y}`;
  };

  const kpis = [
    { label: "Поступления (всего)", value: EUR(months.reduce((s, m) => s + Number(m.revenue), 0)) },
    { label: "Закрыто заказов", value: String(closed.length) },
    { label: "Средний чек", value: EUR(avgCheck) },
    { label: "Маржа (без НДС-правды)", value: `${EUR(marginTotal)} · ${PCT(marginPct)}` },
    { label: "Загрузка автопарка (60 дн)", value: PCT(utilization) },
    { label: "Отмены", value: PCT(cancelRate) },
  ];

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Аналитика</h1>
      <p className="mb-6 text-sm text-muted">{user.name} · выручка, загрузка, маржинальность</p>

      {/* KPI */}
      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((c) => (
          <div key={c.label} className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink">{c.label}</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{c.value}</div>
          </div>
        ))}
      </section>

      {/* Выручка по месяцам */}
      <section className="card mb-8 overflow-x-auto p-4">
        <h2 className="mb-3 font-semibold">Выручка по месяцам</h2>
        {months.length === 0 ? (
          <p className="py-2 text-sm text-muted">Платежей пока нет.</p>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2">Месяц</th>
                <th className="tabular-nums">Поступления</th>
                <th className="tabular-nums">Возвраты</th>
                <th className="tabular-nums">Заявок (по дате переезда)</th>
                <th className="tabular-nums">Объём, м³</th>
                <th className="tabular-nums">Сумма заказов</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const om = orderByMonth.get(m.month);
                return (
                  <tr key={m.month} className="border-b border-line">
                    <td className="py-2 font-medium">{monthLabel(m.month)}</td>
                    <td className="tabular-nums">{EUR(Number(m.revenue))}</td>
                    <td className="tabular-nums text-danger">{Number(m.refunds) > 0 ? `−${EUR(Number(m.refunds))}` : "—"}</td>
                    <td className="tabular-nums">{om ? Number(om.cnt) : 0}</td>
                    <td className="tabular-nums">{om ? Number(om.volume).toFixed(1) : "—"}</td>
                    <td className="tabular-nums">{om ? EUR(Number(om.gross)) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted">Поступления — по дате платежа (UTC). Заявки/объём — по дате переезда, без отменённых.</p>
      </section>

      {/* Загрузка по дням */}
      <section className="card mb-8 p-4">
        <h2 className="mb-2 font-semibold">Загрузка автопарка</h2>
        <p className="text-sm text-muted">
          Активных машин: <b>{fleetSize}</b> · дней с рейсами (60 дн): <b>{busyDays}</b> ·
          машино-дней занято: <b>{totalVehDays}</b> · средняя загрузка: <b>{PCT(utilization)}</b>
        </p>
        <p className="mt-1 text-xs text-muted">
          Себестоимость экипажей закрытых заказов: {EUR(crewCostTotal)} ({PCT(costPct)} от выручки закрытых) ·
          отработано экипажами: {totalHours.toFixed(1)} ч
        </p>
        <p className="mt-1 text-xs text-muted">
          Выплаты партнёрам (субподрядчики, закрытые): {EUR(subCostTotal)} ·
          реальная маржа (за вычетом экипажей и партнёров): <b>{EUR(realMarginTotal)} ({PCT(realMarginPct)})</b>
        </p>
      </section>

      {/* Воронка */}
      <section className="card mb-8 p-4">
        <h2 className="mb-3 font-semibold">Воронка статусов</h2>
        <div className="flex flex-wrap gap-2">
          {statusCounts.map((s) => (
            <span key={s.status} className="chip">
              {STATUS_LABEL[s.status] ?? s.status}: {Number(s.n)}
            </span>
          ))}
          {statusCounts.length === 0 && <p className="text-sm text-muted">Заказов пока нет.</p>}
        </div>
      </section>

      <p className="text-xs text-muted">
        Маржа = сумма закрытых заказов − себестоимость экипажа (строка «crew» из зафиксированного снимка расчёта).
        Прочие затраты (топливо, амортизация) в демо не учитываются.
      </p>
    </>
  );
}
