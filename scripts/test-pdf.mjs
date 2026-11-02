// Тест рендера PDF против живых данных заказа MS-2026-8941 / счёта RE-2026-0001.
// usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/test-pdf.mjs
import { createClient } from "@libsql/client";
import { renderInvoicePdf, renderProtocolPdf, renderQuotePdf } from "../src/lib/pdf.ts";
import { writeFileSync } from "node:fs";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// --- Инвойс ---
const invRes = await db.execute({
  sql: `SELECT i.number, i.order_id, i.status, i.due_date, o.ref, o.from_text, o.to_text, o.move_date,
               o.net_cents, o.vat_cents, o.gross_cents, o.snapshot, o.contact_name, o.contact_email
        FROM invoices i JOIN orders o ON o.id = i.order_id WHERE i.number = 'RE-2026-0001'`,
});
const inv = invRes.rows[0];
if (!inv) { console.error("invoice not found"); process.exit(1); }

const paidRes = await db.execute({
  sql: "SELECT COALESCE(SUM(amount_cents),0) AS paid FROM payments WHERE order_id = ? AND amount_cents > 0",
  args: [inv.order_id],
});
const linesRes = await db.execute({
  sql: "SELECT label, amount FROM order_lines WHERE order_id = ? AND kind = 'line' ORDER BY idx",
  args: [inv.order_id],
});
const snap = JSON.parse(String(inv.snapshot));
const invoiceBytes = await renderInvoicePdf({
  number: String(inv.number),
  orderRef: String(inv.ref),
  customerName: String(inv.contact_name),
  customerEmail: String(inv.contact_email),
  routeFrom: String(inv.from_text),
  routeTo: String(inv.to_text),
  moveDate: String(inv.move_date),
  lines: linesRes.rows.map(l => ({ label: String(l.label), amount: Number(l.amount) })),
  netCents: Number(inv.net_cents),
  vatCents: Number(inv.vat_cents),
  vatPct: snap.tariffs?.vatPct ?? 19,
  grossCents: Number(inv.gross_cents),
  paidCents: Number(paidRes.rows[0].paid),
  dueDate: String(inv.due_date),
  cancelled: false,
});
writeFileSync("test-invoice.pdf", invoiceBytes);
console.log("invoice.pdf OK,", invoiceBytes.length, "bytes");

// --- Протокол ---
const protoRes = await db.execute({
  sql: "SELECT * FROM protocol WHERE order_id = ?",
  args: [inv.order_id],
});
const proto = protoRes.rows[0];
if (proto) {
  const loaded = JSON.parse(String(proto.loaded_json));
  const oRes = await db.execute({ sql: "SELECT ref, from_text, to_text, move_date, volume_m3, contact_name FROM orders WHERE id = ?", args: [inv.order_id] });
  const o = oRes.rows[0];
  const protoBytes = await renderProtocolPdf({
    orderRef: String(o.ref),
    customerName: String(o.contact_name),
    routeFrom: String(o.from_text),
    routeTo: String(o.to_text),
    moveDate: String(o.move_date),
    plannedM3: Number(o.volume_m3),
    factM3: loaded.factM3 ?? Number(o.volume_m3),
    deviationM3: Number(proto.deviation_m3),
    checklist: (loaded.items ?? []).map(i => ({ label: String(i.label ?? i), ok: true })),
    notes: proto.notes ? String(proto.notes) : "",
    signature: String(proto.signature),
    hash: String(proto.hash),
    prevHash: proto.prev_hash ? String(proto.prev_hash) : "",
    signedAt: Number(proto.signed_at),
  });
  writeFileSync("test-protocol.pdf", protoBytes);
  console.log("protocol.pdf OK,", protoBytes.length, "bytes");
} else {
  console.log("protocol: none (skipped)");
}

// --- Kostenvoranschlag (из отменённого заказа MS-2026-8942) ---
const qRes = await db.execute({
  sql: "SELECT ref, from_text, to_text, move_date, volume_m3, distance_km, net_cents, vat_cents, gross_cents, deposit_cents, snapshot, contact_name FROM orders WHERE ref = 'MS-2026-8942'",
});
const q = qRes.rows[0];
if (q) {
  const qsnap = JSON.parse(String(q.snapshot));
  const qlRes = await db.execute({ sql: "SELECT label, amount FROM order_lines WHERE order_id = (SELECT id FROM orders WHERE ref = 'MS-2026-8942') AND kind = 'line' ORDER BY idx" });
  const quoteBytes = await renderQuotePdf({
    orderRef: String(q.ref),
    customerName: String(q.contact_name),
    routeFrom: String(q.from_text),
    routeTo: String(q.to_text),
    moveDate: String(q.move_date),
    volumeM3: Number(q.volume_m3),
    distanceKm: Number(q.distance_km),
    lines: qlRes.rows.map(l => ({ label: String(l.label), amount: Number(l.amount) })),
    netCents: Number(q.net_cents),
    vatCents: Number(q.vat_cents),
    vatPct: qsnap.tariffs?.vatPct ?? 19,
    grossCents: Number(q.gross_cents),
    depositCents: Number(q.deposit_cents),
    validUntil: qsnap.quoteValidUntil ?? "",
  });
  writeFileSync("test-quote.pdf", quoteBytes);
  console.log("quote.pdf OK,", quoteBytes.length, "bytes");
}
console.log("ALL PDF TESTS DONE");
