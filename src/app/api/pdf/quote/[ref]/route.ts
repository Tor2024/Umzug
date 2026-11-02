import { NextRequest } from "next/server";
import { getDb, getTariffs, findSession } from "@/lib/db";
import { COOKIE } from "@/lib/auth";
import { renderQuotePdf } from "@/lib/pdf";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/** GET /api/pdf/quote/[ref] — Kostenvoranschlag по заявке (клиент-владелец или staff). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  const token = req.cookies.get(COOKIE)?.value;
  const user = token ? await findSession(await getDb(), token) : null;
  if (!user) return new Response("Unauthorized", { status: 401 });
  const rl = rateLimit(`pdf:${user.id ?? clientIp(req)}`, 30);
  if (!rl.ok) return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": String(rl.retryAfterS) } });

  const { ref } = await ctx.params;
  const db = await getDb();

  const oRes = await db.execute({
    sql: `SELECT id, ref, client_id, contact_name, from_text, to_text, move_date, volume_m3,
                 distance_km, net_cents, vat_cents, gross_cents, deposit_cents, snapshot, status
          FROM orders WHERE ref = ?`,
    args: [ref],
  });
  const order = oRes.rows[0] as unknown as
    | {
        id: number; ref: string; client_id: number; contact_name: string;
        from_text: string; to_text: string; move_date: string; volume_m3: number;
        distance_km: number; net_cents: number; vat_cents: number; gross_cents: number;
        deposit_cents: number; snapshot: string; status: string;
      }
    | undefined;
  if (!order) return new Response("Not found", { status: 404 });
  if (user.role === "kunde" && order.client_id !== user.id) return new Response("Forbidden", { status: 403 });

  let vatPct = 19;
  let validUntil = "";
  try {
    const snap = JSON.parse(order.snapshot) as { tariffs?: { vatPct?: number }; quoteValidUntil?: string };
    vatPct = snap.tariffs?.vatPct ?? 19;
    validUntil = snap.quoteValidUntil ?? "";
  } catch {
    /* битый снимок */
  }

  const linesRes = await db.execute({
    sql: "SELECT label, amount FROM order_lines WHERE order_id = ? AND kind = 'line' ORDER BY idx",
    args: [order.id],
  });
  const lines = (linesRes.rows as unknown as Array<{ label: string; amount: number }>).map((l) => ({
    label: l.label,
    amount: Number(l.amount),
  }));

  const bytes = await renderQuotePdf({
    orderRef: order.ref,
    customerName: order.contact_name,
    routeFrom: order.from_text,
    routeTo: order.to_text,
    moveDate: order.move_date,
    volumeM3: order.volume_m3,
    distanceKm: order.distance_km,
    lines,
    netCents: Number(order.net_cents),
    vatCents: Number(order.vat_cents),
    vatPct,
    grossCents: Number(order.gross_cents),
    depositCents: Number(order.deposit_cents),
    validUntil,
  });

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Kostenvoranschlag-${order.ref}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
