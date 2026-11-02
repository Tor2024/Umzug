import { NextRequest } from "next/server";
import { getDb, findSession } from "@/lib/db";
import { COOKIE } from "@/lib/auth";
import { renderProtocolPdf } from "@/lib/pdf";

/** GET /api/pdf/protocol/[ref] — протокол приёмки (клиент-владелец, driver, logist, admin, finance). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  const token = req.cookies.get(COOKIE)?.value;
  const user = token ? await findSession(await getDb(), token) : null;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { ref } = await ctx.params;
  const db = await getDb();

  const oRes = await db.execute({
    sql: `SELECT id, ref, client_id, contact_name, from_text, to_text, move_date, volume_m3
          FROM orders WHERE ref = ?`,
    args: [ref],
  });
  const order = oRes.rows[0] as unknown as
    | { id: number; ref: string; client_id: number; contact_name: string; from_text: string; to_text: string; move_date: string; volume_m3: number }
    | undefined;
  if (!order) return new Response("Not found", { status: 404 });
  if (user.role === "kunde" && order.client_id !== user.id) return new Response("Forbidden", { status: 403 });

  const pRes = await db.execute({
    sql: "SELECT loaded_json, deviation_m3, notes, signature, hash, prev_hash, signed_at FROM protocol WHERE order_id = ?",
    args: [order.id],
  });
  const proto = pRes.rows[0] as unknown as
    | { loaded_json: string; deviation_m3: number; notes: string; signature: string; hash: string; prev_hash: string; signed_at: number }
    | undefined;
  if (!proto) return new Response("Protocol not ready", { status: 404 });

  let checklist: string[] = [];
  let factM3 = order.volume_m3;
  try {
    const loaded = JSON.parse(proto.loaded_json) as { items?: string[]; factM3?: number };
    checklist = loaded.items ?? [];
    if (typeof loaded.factM3 === "number") factM3 = loaded.factM3;
  } catch {
    /* битый JSON — оставляем дефолт */
  }

  const bytes = await renderProtocolPdf({
    orderRef: order.ref,
    customerName: order.contact_name,
    routeFrom: order.from_text,
    routeTo: order.to_text,
    moveDate: order.move_date,
    plannedM3: order.volume_m3,
    factM3,
    deviationM3: Number(proto.deviation_m3),
    checklist,
    notes: proto.notes,
    signature: proto.signature,
    hash: proto.hash,
    prevHash: proto.prev_hash,
    signedAt: Number(proto.signed_at),
  });

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Protokoll-${order.ref}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
