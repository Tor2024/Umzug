// Ежедневный cron (0 6 * * *): напоминания о неподтверждённых заявках.
// За 48ч и за 24ч до переезда: если заявка всё ещё в статусе «новая» —
// письмо клиенту («подтвердите заявку до выезда») + запись в order_history.
// Идемпотентно: повторное письмо в тот же день не отправляется (guard по distinct-событию).
// Защита: Bearer CRON_SECRET (Vercel подставляет автоматически при cron-вызове).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { logOrderEvent } from "@/lib/db";
import { sendOrderReminderEmail } from "@/lib/email";

export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const nowS = Date.parse(new Date().toISOString()) / 1000;
  const in48h = nowS + 48 * 3600;
  const in24h = nowS + 24 * 3600;

  // Неподтверждённые заявки с датой переезда в ближайшие 48 часов
  const res = await db.execute({
    sql: `SELECT id, ref, contact_name, contact_email, move_date, status
          FROM orders
          WHERE status = 'new' AND contact_email NOT LIKE '%@deleted.local'
            AND move_date >= date('now')
          ORDER BY move_date ASC LIMIT 100`,
    args: [],
  });
  const rows = res.rows as unknown as
    Array<{ id: number; ref: string; contact_name: string; contact_email: string; move_date: string; status: string }>;

  let reminded48 = 0;
  let reminded24 = 0;

  for (const o of rows) {
    const moveTs = Date.parse(o.move_date + "T08:00:00") / 1000; // якорь 08:00 Berlin (упрощённо)
    if (Number.isNaN(moveTs)) continue;

    // Окно: 48ч — ровно сутки later до 24ч; 24ч — до выезда
    const hoursLeft = Math.round((moveTs - nowS) / 3600);
    let kind: "48h" | "24h" | null = null;
    if (hoursLeft <= 48 && hoursLeft > 24) kind = "48h";
    else if (hoursLeft <= 24 && hoursLeft >= 0) kind = "24h";
    if (!kind) continue;

    // Идемпотентность: история не должна уже содержать reminder_<kind> для этого заказа СЕГОДНЯ
    const hist = await db.execute({
      sql: `SELECT id FROM order_history
            WHERE order_id = ? AND action = ?
              AND at >= ?
            LIMIT 1`,
      args: [o.id, `reminder_${kind}`, nowS - 20 * 3600],
    });
    if (hist.rows.length > 0) continue;

    await sendOrderReminderEmail(o.contact_email, o.contact_name, o.ref, o.move_date, kind);
    await logOrderEvent(
      db, o.id,
      { id: 0, email: "system@umzugservice.example", name: "Система", role: "admin" },
      `reminder_${kind}`,
      { hoursLeft },
    );
    if (kind === "48h") reminded48++; else reminded24++;
  }

  return NextResponse.json({ ok: true, checked: rows.length, reminded48, reminded24 });
}
