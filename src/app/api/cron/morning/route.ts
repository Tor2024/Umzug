// Ежедневный cron (0 7 * * *): утренняя сводка.
// №8 — письма водителям о сегодняшних поездках (реф, время, адреса, машина, требования).
// №6 — пересчёт трафика по сегодняшним заказам: если реальное время в пути
//       > 1.15 × из снимка — письмо клиенту о задержке + traffic_delay в историю.
// №10 — дайджест админу: заказы за сутки по статусам, просроченные счета,
//       незаназначенные на 48ч, загрузка парка.
// Идемпотентность — как в /api/cron/reminders: guard по событию в order_history за 20ч.
// Защита: Bearer CRON_SECRET (Vercel подставляет автоматически при cron-вызове).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, logOrderEvent, type SessionUser } from "@/lib/db";
import { resolveRoute } from "@/lib/geo";
import { sendDriverMorningEmail, sendTrafficDelayEmail, sendAdminDigestEmail } from "@/lib/email";

export const maxDuration = 300;

const SYSTEM_ACTOR: SessionUser = { id: 0, email: "system@umzugservice.example", name: "Система", role: "admin" };

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const nowS = Math.floor(Date.parse(new Date().toISOString()) / 1000);
  const today = new Date().toISOString().slice(0, 10); // UTC-дата; для демо достаточно
  const dayAgoS = nowS - 24 * 3600;

  // ── №8: утренние письма водителям о сегодняшних поездках ───────────────
  const tripsRes = await db.execute({
    sql: `SELECT o.id AS order_id, o.ref, o.start_time, o.from_text, o.to_text,
                 o.self_pack, o.special_requests, o.special_approved,
                 u.email AS driver_email, u.name AS driver_name,
                 v.label AS vehicle_label, v.plate
          FROM trips t
          JOIN orders o ON o.id = t.order_id
          JOIN users u ON u.id = t.driver_id
          JOIN vehicles v ON v.id = t.vehicle_id
          WHERE t.move_date = ? AND o.status IN ('assigned','enroute')
          ORDER BY o.start_time ASC LIMIT 50`,
    args: [today],
  });
  const trips = tripsRes.rows as unknown as Array<{
    order_id: number; ref: string; start_time: string; from_text: string; to_text: string;
    self_pack: number; special_requests: string | null; special_approved: number | null;
    driver_email: string; driver_name: string; vehicle_label: string; plate: string;
  }>;

  let morningEmails = 0;
  for (const t of trips) {
    // Идемпотентность: письмо не чаще раза в сутки
    const hist = await db.execute({
      sql: `SELECT id FROM order_history WHERE order_id = ? AND action = 'driver_morning_email' AND at >= ? LIMIT 1`,
      args: [t.order_id, nowS - 20 * 3600],
    });
    if (hist.rows.length > 0) continue;

    const requirements = t.special_approved === 1 ? t.special_requests : null;
    await sendDriverMorningEmail(
      t.driver_email, t.driver_name, t.ref, t.start_time, t.from_text, t.to_text,
      `${t.vehicle_label} (${t.plate})`, requirements, t.self_pack === 1,
    );
    await logOrderEvent(db, t.order_id, SYSTEM_ACTOR, "driver_morning_email", { driverEmail: t.driver_email });
    morningEmails++;
  }

  // ── №6: пересчёт трафика по сегодняшним заказам ────────────────────────
  const routeRes = await db.execute({
    sql: `SELECT o.id, o.ref, o.contact_name, o.contact_email, o.from_text, o.to_text, r.minutes AS snap_minutes
          FROM orders o
          JOIN route r ON r.order_id = o.id
          WHERE o.move_date = ? AND o.status IN ('assigned','enroute')
          LIMIT 50`,
    args: [today],
  });
  const routeRows = routeRes.rows as unknown as Array<{
    id: number; ref: string; contact_name: string; contact_email: string;
    from_text: string; to_text: string; snap_minutes: number;
  }>;

  let trafficDelays = 0;
  for (const o of routeRows) {
    // Идемпотентность: не чаще раза в сутки
    const hist = await db.execute({
      sql: `SELECT id FROM order_history WHERE order_id = ? AND action = 'traffic_delay' AND at >= ? LIMIT 1`,
      args: [o.id, nowS - 20 * 3600],
    });
    if (hist.rows.length > 0) continue;

    const route = await resolveRoute(o.from_text, o.to_text, process.env.GOOGLE_MAPS_API_KEY);
    if (!route || route.provider === "fallback") continue;
    if (route.minutes <= Math.round(o.snap_minutes * 1.15)) continue;

    await sendTrafficDelayEmail(o.contact_email, o.contact_name, o.ref, Math.round(o.snap_minutes * 1.15), route.minutes);
    await logOrderEvent(db, o.id, SYSTEM_ACTOR, "traffic_delay", {
      snapMinutes: o.snap_minutes, actualMinutes: route.minutes,
    });
    trafficDelays++;
  }

  // ── №10: дайджест админу ───────────────────────────────────────────────
  const statusRes = await db.execute({
    sql: `SELECT status, COUNT(*) AS cnt FROM orders WHERE updated_at >= ? GROUP BY status`,
    args: [dayAgoS],
  });
  const statusRows = statusRes.rows as unknown as Array<{ status: string; cnt: number }>;
  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = Number(r.cnt);

  const overdueRes = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM invoices WHERE status = 'open' AND due_date < date('now')`,
    args: [],
  });
  const overdueCount = Number((overdueRes.rows[0] as unknown as { cnt: number }).cnt);

  const unassignedRes = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM orders
          WHERE status = 'confirmed'
            AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.order_id = orders.id)
            AND move_date <= date('now', '+2 day')`,
    args: [],
  });
  const unassignedCount = Number((unassignedRes.rows[0] as unknown as { cnt: number }).cnt);

  const fleetRes = await db.execute({
    sql: `SELECT COUNT(*) AS total,
                 (SELECT COUNT(*) FROM assignments a
                   WHERE a.resource_type = 'vehicle' AND a.move_date = ?
                     AND a.resource_id IN (SELECT id FROM vehicles WHERE active = 1)) AS busy
          FROM vehicles WHERE active = 1`,
    args: [today],
  });
  const fleetRow = fleetRes.rows[0] as unknown as { total: number; busy: number } | undefined;

  const adminRes = await db.execute({
    sql: `SELECT email FROM users WHERE role = 'admin' AND active = 1 AND email NOT LIKE '%@deleted.local' LIMIT 5`,
    args: [],
  });

  let digestSent = 0;
  for (const a of adminRes.rows as unknown as Array<{ email: string }>) {
    await sendAdminDigestEmail(
      a.email, byStatus, overdueCount, unassignedCount,
      fleetRow ? Number(fleetRow.busy) : 0, fleetRow ? Number(fleetRow.total) : 0,
    );
    digestSent++;
  }

  return NextResponse.json({
    ok: true, morningEmails, trafficDelays, digestSent,
    byStatus, overdueCount, unassignedCount,
  });
}
