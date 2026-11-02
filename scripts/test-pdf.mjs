// Тест PDF против живых данных Turso (invoice RE-2026-0001, quote+protocol MS-2026-8941).
// Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/test-pdf.mjs
import { createClient } from "@libsql/client";
import { renderInvoicePdf, renderProtocolPdf, renderQuotePdf, buildSpecLines, deLabel } from "../src/lib/pdf.ts";
import { writeFileSync } from "node:fs";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) { console.error("Need TURSO env"); process.exit(1); }
const db = createClient({ url, authToken: token });

function rows(r) { return r.rows; }

// ── Invoice ──
const invRes = await db.execute(`
  SELECT i.number, i.order_id, i.amount_cents, i.status, i.due_date,
         o.ref, o.contact_name, o.contact_email, o.from_text, o.to_text,
         o.move_date, o.net_cents, o.vat_cents, o.gross_cents, o.snapshot
  FROM invoices i JOIN orders o ON o.id = i.order_id
  WHERE i.status <> 'cancelled' ORDER BY i.number DESC LIMIT 1`);
const inv = rows(invRes)[0];
if (!inv) { console.error("no invoice"); process.exit(1); }

const paidRes = await db.execute({ sql: "SELECT COALESCE(SUM(amount_cents),0) AS p FROM payments WHERE order_id = ? AND amount_cents > 0", args: [inv.order_id] });
const paid = Number(rows(paidRes)[0].p);

const linesRes = await db.execute({ sql: "SELECT label, amount FROM order_lines WHERE order_id = ? AND kind = 'line' ORDER BY idx", args: [inv.order_id] });
const lines = rows(linesRes).map((l) => ({ label: deLabel(l.label), amount: Number(l.amount) }));

const snap = JSON.parse(inv.snapshot);
const cls = String(snap.config.vehicleClass ?? "B");
const classLabel = deLabel(snap.tariffs?.classes?.[cls]?.label ?? cls);
const specLines = buildSpecLines(snap.config, classLabel);

const invBytes = await renderInvoicePdf({
  number: inv.number, orderRef: inv.ref,
  customerName: inv.contact_name, customerEmail: inv.contact_email,
  routeFrom: inv.from_text, routeTo: inv.to_text, moveDate: inv.move_date,
  lines, specLines, snapshotVersion: snap.snapshotVersion ?? 1,
  netCents: Number(inv.net_cents), vatCents: Number(inv.vat_cents), vatPct: snap.tariffs?.vatPct ?? 19,
  grossCents: Number(inv.gross_cents), paidCents: paid, dueDate: inv.due_date,
  cancelled: inv.status === "cancelled",
});
writeFileSync("test-invoice.pdf", invBytes);
console.log("invoice:", invBytes.length, "bytes; lines:", lines.length, "spec:", specLines.length);

// ── Protocol ──
const pRes = await db.execute(`
  SELECT p.*, o.ref, o.contact_name, o.from_text, o.to_text, o.move_date, o.volume_m3
  FROM protocol p JOIN orders o ON o.id = p.order_id ORDER BY p.id DESC LIMIT 1`);
const p = rows(pRes)[0];
if (p) {
  const loaded = JSON.parse(p.loaded_json);
  const pBytes = await renderProtocolPdf({
    orderRef: p.ref, customerName: p.contact_name,
    routeFrom: p.from_text, routeTo: p.to_text, moveDate: p.move_date,
    plannedM3: Number(p.volume_m3 ?? loaded.plan_m3 ?? 0), factM3: loaded.fact_m3 ?? 0,
    deviationM3: Number(p.deviation_m3),
    checklist: (loaded.items ?? []).filter((i) => i.checked).map((i) => deLabel(i.label)),
    notes: p.notes, signature: p.signature, hash: p.hash, prevHash: p.prev_hash, signedAt: Number(p.signed_at),
  });
  writeFileSync("test-protocol.pdf", pBytes);
  console.log("protocol:", pBytes.length, "bytes");
} else console.log("protocol: none");

// ── Quote ──
const qRes = await db.execute(`SELECT * FROM orders WHERE ref = 'MS-2026-8942'`);
const q = rows(qRes)[0];
if (q) {
  const qSnap = JSON.parse(q.snapshot);
  const qLinesRes = await db.execute({ sql: "SELECT label, amount FROM order_lines WHERE order_id = ? AND kind = 'line' ORDER BY idx", args: [q.id] });
  const qLines = rows(qLinesRes).map((l) => ({ label: deLabel(l.label), amount: Number(l.amount) }));
  const qSpec = buildSpecLines(qSnap.config, deLabel(qSnap.tariffs?.classes?.[qSnap.config.vehicleClass]?.label ?? qSnap.config.vehicleClass));
  const qBytes = await renderQuotePdf({
    orderRef: q.ref, customerName: q.contact_name,
    routeFrom: q.from_text, routeTo: q.to_text, moveDate: q.move_date,
    volumeM3: q.volume_m3, distanceKm: q.distance_km,
    lines: [...qLines, ...qSpec],
    netCents: Number(q.net_cents), vatCents: Number(q.vat_cents), vatPct: qSnap.tariffs?.vatPct ?? 19,
    grossCents: Number(q.gross_cents), depositCents: Number(q.deposit_cents), validUntil: qSnap.quoteValidUntil,
  });
  writeFileSync("test-quote.pdf", qBytes);
  console.log("quote:", qBytes.length, "bytes");
}
console.log("ALL OK");
