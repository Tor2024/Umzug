// Аналитика (задача 7, редизайн @1842): выручка, загрузка, маржинальность — с графиками.
// Источники: payments (денежная правда, D2), orders (объёмы/даты), snapshots (себестоимость экипажа).
// Графики — server-safe SVG из components/charts.tsx (без клиентского JS).

import { connection } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { Metadata } from "next";
import { BarChart, Donut, StackBar, Sparkline } from "@/components/charts";

export const instant = false;
export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Аналитика" };

const EUR = (cents: number): string =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100);
const PCT = (x: number): string => `${(x * 100).toFixed(1)} %`;

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

type SnapshotLite = {
  quote: { lines: Array<{ key: string; amount: number }>; workHours: number };
};

// Палитра воронки (по порядку pipeline; cancelled — серый)
const STATUS_COLORS: Record<string, string> = {
  new: "#f59e0b",
  confirmed: "#3b82f6",
  assigned: "#8b5cf6",
  enroute: "#06b6d4",
  acceptance: "#14b8a6",
  closed: "#10b981",
  cancelled: "#94a3b8",
};

export default async function AnalyticsPage() {
  await connection();
  const user = await requireRole(["finance", "admin"], "/analytics");
  const db = await getDb();

  // --- 1. Выручка по месяцам: payments (поступления и возвраты) ---
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

  // Выплаты партнёрам по закрытым заказам (субподрядчики, ) → реальная маржа
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

  // --- График выручки: chronological asc, бар + спарклайн ---
  const revenueAsc = [...months].reverse();
  const revenueBars = revenueAsc.map((m) => ({
    label: monthLabel(m.month).replace(/^(...).* (\d{4})$/, "$1 $2"),
    value: Number(m.revenue),
    color: "#EA7A28",
  }));
  const revenueSpark = revenueAsc.map((m) => Number(m.revenue));

  // KPI-карточки (цветные, с трендами)
  const kpis = [
    {
      label: "Поступления (всего)",
      value: EUR(months.reduce((s, m) => s + Number(m.revenue), 0)),
      color: "#EA7A28", icon: "€", sub: `${months.length} мес. платежей`,
    },
    {
      label: "Закрыто заказов",
      value: String(closed.length),
      color: "#10b981", icon: "✓", sub: `средний чек ${EUR(avgCheck)}`,
    },
    {
      label: "Маржа (экипажи)",
      value: EUR(marginTotal),
      color: "#3b82f6", icon: "▲", sub: `${PCT(marginPct)} от выручки закрытых`,
    },
    {
      label: "Реальная маржа",
      value: EUR(realMarginTotal),
      color: "#8b5cf6", icon: "◆", sub: `за вычетом партнёров (${EUR(subCostTotal)})`,
    },
    {
      label: "Загрузка автопарка",
      value: PCT(utilization),
      color: "#06b6d4", icon: "▦", sub: `${fleetSize} машин · ${busyDays} дней с рейсами`,
    },
    {
      label: "Отмены",
      value: PCT(cancelRate),
      color: cancelRate > 0.15 ? "#ba1a1a" : "#94a3b8", icon: "✕", sub: `${cancelled} из ${totalOrders} заявок`,
    },
  ];

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Аналитика</h1>
      <p className="mb-6 text-sm text-muted">{user.name} · выручка, загрузка, маржинальность</p>

      {/* KPI — цветные карточки */}
      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">{k.label}</div>
                <div className="mt-1 truncate text-xl font-bold tabular-nums text-ink">{k.value}</div>
                <div className="mt-0.5 truncate text-xs text-muted">{k.sub}</div>
              </div>
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-base text-base font-bold text-white"
                style={{ backgroundColor: k.color }}
              >
                {k.icon}
              </span>
            </div>
          </div>
        ))}
      </section>

      {/* Выручка: бар-чарт + спарклайн */}
      <section className="card mb-6 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Выручка по месяцам</h2>
          <span className="text-xs text-muted">поступления, € (без возвратов)</span>
        </div>
        {months.length === 0 ? (
          <p className="py-4 text-sm text-muted">Платежей пока нет.</p>
        ) : (
          <>
            <BarChart data={revenueBars} height={170} formatValue={(v) => EUR(v)} />
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-accent hover:underline">Показать таблицу</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                      <th className="py-2">Месяц</th>
                      <th className="tabular-nums">Поступления</th>
                      <th className="tabular-nums">Возвраты</th>
                      <th className="tabular-nums">Заявок</th>
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
              </div>
            </details>
          </>
        )}
      </section>

      {/* Индикаторы: донаты + спарклайн выручки */}
      <section className="card mb-6 p-4">
        <h2 className="mb-4 font-semibold">Ключевые индикаторы</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Donut pct={marginPct} label="Маржа" sub={EUR(marginTotal)} color="#3b82f6" />
          <Donut pct={realMarginPct} label="Реальная маржа" sub={EUR(realMarginTotal)} color="#8b5cf6" />
          <Donut pct={utilization} label="Загрузка парка" sub={`${fleetSize} машин, 60 дн.`} color="#06b6d4" />
          <Donut pct={cancelRate} label="Отмены" sub={`${cancelled} заявок`} color={cancelRate > 0.15 ? "#ba1a1a" : "#94a3b8"} />
        </div>
        {revenueSpark.length >= 2 && (
          <div className="mt-6 border-t border-line pt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Динамика поступлений</p>
            <Sparkline points={revenueSpark} color="#EA7A28" />
            <div className="flex justify-between text-[11px] text-muted">
              <span>{revenueAsc.length > 0 ? monthLabel(revenueAsc[0].month) : ""}</span>
              <span>{revenueAsc.length > 1 ? monthLabel(revenueAsc[revenueAsc.length - 1].month) : ""}</span>
            </div>
          </div>
        )}
      </section>

      {/* Загрузка по дням */}
      <section className="card mb-6 p-4">
        <h2 className="mb-2 font-semibold">Загрузка автопарка</h2>
        <p className="text-sm text-muted">
          Активных машин: <b>{fleetSize}</b> · дней с рейсами (60 дн): <b>{busyDays}</b> ·
          машино-дней занято: <b>{totalVehDays}</b> · средняя загрузка: <b>{PCT(utilization)}</b>
        </p>
        <p className="mt-1 text-xs text-muted">
          Себестоимость экипажей закрытых заказов: {EUR(crewCostTotal)} ({PCT(costPct)} от выручки закрытых) ·
          отработано экипажами: {totalHours.toFixed(1)} ч
        </p>
      </section>

      {/* Воронка: цветной стек-бар */}
      <section className="card mb-6 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Воронка статусов</h2>
          <span className="text-xs text-muted">{totalOrders} заявок всего</span>
        </div>
        {statusCounts.length === 0 ? (
          <p className="text-sm text-muted">Заказов пока нет.</p>
        ) : (
          <StackBar
            data={[...statusCounts]
              .sort((a, b) => {
                const order = ["new", "confirmed", "assigned", "enroute", "acceptance", "closed", "cancelled"];
                return order.indexOf(a.status) - order.indexOf(b.status);
              })
              .map((s) => ({ label: STATUS_LABEL[s.status] ?? s.status, value: Number(s.n), color: STATUS_COLORS[s.status] ?? "#94a3b8" }))}
          />
        )}
      </section>

      <p className="text-xs text-muted">
        Маржа = сумма закрытых заказов − себестоимость экипажа (строка «crew» из зафиксированного снимка расчёта).
        Прочие затраты (топливо, амортизация) в демо не учитываются.
      </p>
    </>
  );
}
