import { NextRequest } from "next/server";
import { getDb, findSession } from "@/lib/db";
import { COOKIE } from "@/lib/auth";
import { renderInvoicePdf, buildSpecLines, deLabel } from "@/lib/pdf";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/** GET /api/pdf/invoice/[number] — GoBD-счёт (клиент-владелец или staff). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ number: string }> }) {
  const token = req.cookies.get(COOKIE)?.value;
  const user = token ? await findSession(await getDb(), token) : null;
  if (!user) return new Response("Unauthorized", { status: 401 });
  const rl = rateLimit(`pdf:${user.id ?? clientIp(req)}`, 30);
  if (!rl.ok) return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": String(rl.retryAfterS) } });

  const { number } = await ctx.params;
  const db = await getDb();

  const invRes = await db.execute({
    sql: `SELECT i.number, i.order_id, i.amount_cents, i.status, i.due_date,
                 o.ref, o.client_id, o.contact_name, o.contact_email, o.from_text, o.to_text,
                 o.move_date, o.net_cents, o.vat_cents, o.gross_cents, o.snapshot
          FROM invoices i JOIN orders o ON o.id = i.order_id
          WHERE i.number = ?`,
    args: [number],
  });
  const inv = invRes.rows[0] as unknown as
    | {
        number: string; order_id: number; amount_cents: number; status: string; due_date: string;
        ref: string; client_id: number; contact_name: string; contact_email: string;
        from_text: string; to_text: string; move_date: string;
        net_cents: number; vat_cents: number; gross_cents: number; snapshot: string;
      }
    | undefined;
  if (!inv) return new Response("Not found", { status: 404 });
  if (user.role === "kunde" && inv.client_id !== user.id) return new Response("Forbidden", { status: 403 });

  const paidRes = await db.execute({
    sql: "SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM payments WHERE order_id = ? AND amount_cents > 0",
    args: [inv.order_id],
  });
  const paid = Number((paidRes.rows[0] as unknown as { paid: number }).paid);

  const linesRes = await db.execute({
    sql: "SELECT label, amount FROM order_lines WHERE order_id = ? AND kind = 'line' ORDER BY idx",
    args: [inv.order_id],
  });
  const lines = (linesRes.rows as unknown as Array<{ label: string; amount: number }>).map((l) => ({
    label: deLabel(l.label),
    amount: Number(l.amount),
  }));

  // Полная спецификация услуг + версия снимка (последняя применённая ревизия — D10)
  let specLines: Array<{ label: string; amount: number }> = [];
  let snapshotVersion = 1;
  let classLabel = "";
  try {
    const snap = JSON.parse(inv.snapshot) as {
      config?: Record<string, unknown>;
      tariffs?: { classes?: Record<string, { label: string }> };
      snapshotVersion?: number;
    };
    if (snap.config) {
      const cls = String(snap.config.vehicleClass ?? "B");
      classLabel = deLabel(snap.tariffs?.classes?.[cls]?.label ?? cls);
      specLines = buildSpecLines(snap.config as unknown as Parameters<typeof buildSpecLines>[0], classLabel);
    }
    if (typeof snap.snapshotVersion === "number") snapshotVersion = snap.snapshotVersion;
  } catch {
    /* битый снимок — спецификация опустится */
  }

  // vatPct из снимка (для подписи строки НДС)
  let vatPct = 19;
  try {
    const snap = JSON.parse(inv.snapshot) as { tariffs?: { vatPct?: number } };
    vatPct = snap.tariffs?.vatPct ?? 19;
  } catch {
    /* снимок битый — берём дефолт */
  }

  const bytes = await renderInvoicePdf({
    number: inv.number,
    orderRef: inv.ref,
    customerName: inv.contact_name,
    customerEmail: inv.contact_email,
    routeFrom: inv.from_text,
    routeTo: inv.to_text,
    moveDate: inv.move_date,
    lines,
    specLines,
    snapshotVersion,
    netCents: Number(inv.net_cents),
    vatCents: Number(inv.vat_cents),
    vatPct,
    grossCents: Number(inv.gross_cents),
    paidCents: paid,
    dueDate: inv.due_date,
    cancelled: inv.status === "cancelled",
  });

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${inv.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
