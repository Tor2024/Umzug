// Analytics (DE-Kopie von (dash)/analytics): Umsatz, Auslastung, Marge — mit Diagrammen.
// Datenquellen: payments (cash truth), orders (Volumen/Daten), snapshots (Crew-Kosten).
// Diagramme — server-safe SVG aus components/charts.tsx (ohne Client-JS).

import { connection } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { Metadata } from "next";
import { BarChart, Donut, StackBar, Sparkline } from "@/components/charts";

export const instant = false;
export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Analytik" };

const EUR = (cents: number): string =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100);
const PCT = (x: number): string => `${(x * 100).toFixed(1)} %`;

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

type SnapshotLite = {
  quote: { lines: Array<{ key: string; amount: number }>; workHours: number };
};

// Farbpallette der Funnel (Pipeline-Reihenfolge; cancelled — grau)
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
  const user = await requireRole(["finance", "admin"], "/de/analytics");
  const db = await getDb();

  // --- 1. Umsatz pro Monat: payments (Eingänge und Erstattungen) ---
  const monthRes = await db.execute(
    `SELECT substr(datetime(p.paid_at, 'unixepoch'), 1, 7) AS month,
            SUM(CASE WHEN p.amount_cents > 0 THEN p.amount_cents ELSE 0 END) AS revenue,
            SUM(CASE WHEN p.amount_cents < 0 THEN -p.amount_cents ELSE 0 END) AS refunds
       FROM payments p
      GROUP BY month ORDER BY month DESC LIMIT 12`,
  );
  const months = monthRes.rows as unknown as Array<{ month: string; revenue: number; refunds: number }>;

  // --- 2. Aufträge pro Monat (move_date, ohne cancelled) ---
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

  // --- 3. Crew-Kosten aus Snapshots geschlossener Aufträge (Marge) ---
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
      // beschädigter Snapshot — überspringen
    }
  }
  const marginTotal = closedGrossTotal - crewCostTotal;
  const marginPct = closedGrossTotal > 0 ? marginTotal / closedGrossTotal : 0;
  const avgCheck = closed.length > 0 ? Math.round(closedGrossTotal / closed.length) : 0;
  const costPct = closedGrossTotal > 0 ? crewCostTotal / closedGrossTotal : 0;

  // Partnerauszahlungen geschlossener Aufträge (Subunternehmer) → echte Marge
  const subCostRes = await db.execute(
    `SELECT COALESCE(SUM(os.cost_cents),0) AS s
       FROM order_subcontractors os JOIN orders o ON o.id = os.order_id
      WHERE o.status = 'closed'`,
  );
  const subCostTotal = Number((subCostRes.rows[0] as unknown as { s: number }).s);
  const realMarginTotal = marginTotal - subCostTotal;
  const realMarginPct = closedGrossTotal > 0 ? realMarginTotal / closedGrossTotal : 0;

  // --- 4. Fuhrparkauslastung: trips der letzten 60 Tage + Potenzial ---
  const fleetRes = await db.execute("SELECT COUNT(*) AS n FROM vehicles WHERE active = 1");
  const fleetSize = Number((fleetRes.rows[0] as unknown as { n: number }).n);

  const tripRes = await db.execute(
    `SELECT move_date, COUNT(*) AS trips FROM trips
      WHERE move_date >= date('now', '-60 days')
      GROUP BY move_date ORDER BY move_date DESC LIMIT 60`,
  );
  const tripDays = tripRes.rows as unknown as Array<{ move_date: string; trips: number }>;
  // eindeutige Fahrzeuge pro Tag (ein Auftrag kann mehrere Fahrzeuge belegen)
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

  // --- 5. Status-Funnel ---
  const statusRes = await db.execute(
    `SELECT status, COUNT(*) AS n FROM orders GROUP BY status`,
  );
  const statusCounts = statusRes.rows as unknown as Array<{ status: string; n: number }>;
  const STATUS_LABEL: Record<string, string> = {
    new: "Neue", confirmed: "Bestätigt", assigned: "Zugewiesen", enroute: "Unterwegs",
    acceptance: "Abnahme", closed: "Abgeschlossen", cancelled: "Storniert",
  };
  const totalOrders = statusCounts.reduce((s, r) => s + Number(r.n), 0);
  const cancelled = Number(statusCounts.find((r) => r.status === "cancelled")?.n ?? 0);
  const cancelRate = totalOrders > 0 ? cancelled / totalOrders : 0;

  const monthLabel = (m: string): string => {
    const [y, mm] = m.split("-");
    return `${MONTHS[Number(mm) - 1]} ${y}`;
  };

  // --- Umsatzdiagramm: chronologisch asc, Bar + Sparkline ---
  const revenueAsc = [...months].reverse();
  const revenueBars = revenueAsc.map((m) => ({
    label: monthLabel(m.month).replace(/^(...).* (\d{4})$/, "$1 $2"),
    value: Number(m.revenue),
    color: "#EA7A28",
  }));
  const revenueSpark = revenueAsc.map((m) => Number(m.revenue));

  // KPI-Karten (farbig, mit Trends)
  const kpis = [
    {
      label: "Eingänge (gesamt)",
      value: EUR(months.reduce((s, m) => s + Number(m.revenue), 0)),
      color: "#EA7A28", icon: "€", sub: `${months.length} Mon. Zahlungen`,
    },
    {
      label: "Abgeschlossene Aufträge",
      value: String(closed.length),
      color: "#10b981", icon: "✓", sub: `durchschnittlicher Auftrag ${EUR(avgCheck)}`,
    },
    {
      label: "Marge (Crews)",
      value: EUR(marginTotal),
      color: "#3b82f6", icon: "▲", sub: `${PCT(marginPct)} des Umsatzes geschlossener`,
    },
    {
      label: "Echte Marge",
      value: EUR(realMarginTotal),
      color: "#8b5cf6", icon: "◆", sub: `abzüglich Partner (${EUR(subCostTotal)})`,
    },
    {
      label: "Fuhrparkauslastung",
      value: PCT(utilization),
      color: "#06b6d4", icon: "▦", sub: `${fleetSize} Fahrzeuge · ${busyDays} Tage mit Fahrten`,
    },
    {
      label: "Stornierungen",
      value: PCT(cancelRate),
      color: cancelRate > 0.15 ? "#ba1a1a" : "#94a3b8", icon: "✕", sub: `${cancelled} von ${totalOrders} Anfragen`,
    },
  ];

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Analytik</h1>
      <p className="mb-6 text-sm text-muted">{user.name} · Umsatz, Auslastung, Marge</p>

      {/* KPI — farbige Karten */}
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

      {/* Umsatz: Bar-Chart + Sparkline */}
      <section className="card mb-6 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Umsatz pro Monat</h2>
          <span className="text-xs text-muted">Eingänge, € (ohne Erstattungen)</span>
        </div>
        {months.length === 0 ? (
          <p className="py-4 text-sm text-muted">Noch keine Zahlungen.</p>
        ) : (
          <>
            <BarChart data={revenueBars} height={170} formatValue={(v) => EUR(v)} />
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-accent hover:underline">Tabelle anzeigen</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                      <th className="py-2">Monat</th>
                      <th className="tabular-nums">Eingänge</th>
                      <th className="tabular-nums">Erstattungen</th>
                      <th className="tabular-nums">Anfragen</th>
                      <th className="tabular-nums">Volumen, m³</th>
                      <th className="tabular-nums">Auftragssumme</th>
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

      {/* Indikatoren: Donuts + Umsatz-Sparkline */}
      <section className="card mb-6 p-4">
        <h2 className="mb-4 font-semibold">Kennzahlen</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Donut pct={marginPct} label="Marge" sub={EUR(marginTotal)} color="#3b82f6" />
          <Donut pct={realMarginPct} label="Echte Marge" sub={EUR(realMarginTotal)} color="#8b5cf6" />
          <Donut pct={utilization} label="Fuhrparkauslastung" sub={`${fleetSize} Fahrzeuge, 60 T.`} color="#06b6d4" />
          <Donut pct={cancelRate} label="Stornierungen" sub={`${cancelled} Anfragen`} color={cancelRate > 0.15 ? "#ba1a1a" : "#94a3b8"} />
        </div>
        {revenueSpark.length >= 2 && (
          <div className="mt-6 border-t border-line pt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Verlauf der Eingänge</p>
            <Sparkline points={revenueSpark} color="#EA7A28" />
            <div className="flex justify-between text-[11px] text-muted">
              <span>{revenueAsc.length > 0 ? monthLabel(revenueAsc[0].month) : ""}</span>
              <span>{revenueAsc.length > 1 ? monthLabel(revenueAsc[revenueAsc.length - 1].month) : ""}</span>
            </div>
          </div>
        )}
      </section>

      {/* Auslastung pro Tag */}
      <section className="card mb-6 p-4">
        <h2 className="mb-2 font-semibold">Fuhrparkauslastung</h2>
        <p className="text-sm text-muted">
          Aktive Fahrzeuge: <b>{fleetSize}</b> · Tage mit Fahrten (60 T): <b>{busyDays}</b> ·
          belegte Fahrzeugtage: <b>{totalVehDays}</b> · durchschnittliche Auslastung: <b>{PCT(utilization)}</b>
        </p>
        <p className="mt-1 text-xs text-muted">
          Crew-Kosten geschlossener Aufträge: {EUR(crewCostTotal)} ({PCT(costPct)} des Umsatzes geschlossener) ·
          geleistet von Crews: {totalHours.toFixed(1)} Std.
        </p>
      </section>

      {/* Funnel: farbiger Stack-Bar */}
      <section className="card mb-6 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Status-Funnel</h2>
          <span className="text-xs text-muted">{totalOrders} Anfragen insgesamt</span>
        </div>
        {statusCounts.length === 0 ? (
          <p className="text-sm text-muted">Noch keine Aufträge.</p>
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
        Marge = Summe geschlossener Aufträge − Crew-Kosten (Zeile „crew“ aus dem fixierten Berechnungs-Snapshot).
        Sonstige Kosten (Kraftstoff, Abschreibung) werden in der Demo nicht berücksichtigt.
      </p>
    </>
  );
}
