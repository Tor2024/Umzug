// GDPR ст. 15: экспорт всех персональных данных клиента в JSON.

import { NextResponse } from "next/server";
import { getDb, findSession } from "@/lib/db";
import { COOKIE } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export async function GET(req: Request): Promise<NextResponse> {
  const rl = rateLimit(`gdpr-export:${clientIp(req)}`, 10);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Слишком много запросов" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterS) } },
    );
  }

  const token = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
  const db = await getDb();
  const user = await findSession(db, token);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    legal_basis: "DSGVO Art. 15 — Auskunft / копия персональных данных",
    profile: null as unknown,
    orders: [] as unknown[],
  };

  const profRes = await db.execute({
    sql: "SELECT id, email, name, role, email_verified, created_at FROM users WHERE id = ?",
    args: [user.id],
  });
  out.profile = profRes.rows[0] ?? null;

  const ordRes = await db.execute({
    sql: "SELECT * FROM orders WHERE client_id = ? ORDER BY id",
    args: [user.id],
  });
  const orders = ordRes.rows as unknown as Array<{ id: number; ref: string }>;
  const orderIds = orders.map((o) => Number(o.id));
  out.orders = orders;

  if (orderIds.length > 0) {
    const ph = orderIds.map(() => "?").join(",");
    const linesRes = await db.execute({
      sql: `SELECT * FROM order_lines WHERE order_id IN (${ph}) ORDER BY order_id, idx`,
      args: orderIds,
    });
    out.order_lines = linesRes.rows;
    const protoRes = await db.execute({
      sql: `SELECT order_id, loaded_json, deviation_m3, notes, signature, hash, prev_hash, signed_at FROM protocol WHERE order_id IN (${ph})`,
      args: orderIds,
    });
    out.protocol = protoRes.rows;
    const invRes = await db.execute({
      sql: `SELECT * FROM invoices WHERE order_id IN (${ph})`,
      args: orderIds,
    });
    out.invoices = invRes.rows;
    const payRes = await db.execute({
      sql: `SELECT id, invoice_id, amount_cents, method, paid_at, note FROM payments WHERE order_id IN (${ph})`,
      args: orderIds,
    });
    out.payments = payRes.rows;
    const histRes = await db.execute({
      sql: `SELECT actor_role, action, entity_id, details, created_at FROM order_history WHERE order_id IN (${ph}) ORDER BY id`,
      args: orderIds,
    });
    out.order_history = histRes.rows;
    const claimRes = await db.execute({
      sql: `SELECT * FROM claims WHERE order_id IN (${ph})`,
      args: orderIds,
    });
    out.claims = claimRes.rows;
  } else {
    out.order_lines = [];
    out.protocol = [];
    out.invoices = [];
    out.payments = [];
    out.order_history = [];
    out.claims = [];
  }

  const fname = `gdpr-export-${user.email.replace(/[^a-z0-9@.-]/gi, "_")}.json`;
  return new NextResponse(JSON.stringify(out, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
