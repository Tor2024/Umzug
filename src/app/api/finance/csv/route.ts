// GET /api/finance/csv — CSV-экспорт (D7.12): invoices+payments, ';' разделитель, немецкий формат.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb, findSession, audit } from "@/lib/db";
import { COOKIE } from "@/lib/auth";

export async function GET() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  const user = token ? await findSession(getDb(), token) : null;
  if (!user || (user.role !== "finance" && user.role !== "admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const invRes = await db.execute(
    `SELECT i.number, o.ref, i.amount_cents, i.status, i.dunning_level, i.due_date, i.paid_at
       FROM invoices i JOIN orders o ON o.id = i.order_id ORDER BY i.number`,
  );
  const inv = invRes.rows as unknown as { number: string; ref: string; amount_cents: number; status: string; dunning_level: number; due_date: string; paid_at: number | null }[];
  const payRes = await db.execute(
    `SELECT o.ref, p.amount_cents, p.method, p.paid_at
       FROM payments p JOIN orders o ON o.id = p.order_id ORDER BY p.paid_at`,
  );
  const pay = payRes.rows as unknown as { ref: string; amount_cents: number; method: string; paid_at: number }[];
  const de = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
  const iso = (t: number | null) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : "");
  const lines: string[] = [];
  lines.push("Typ;Nummer;Bestellung;Betrag_EUR;Status;Mahnstufe;Faellig;Bezahlt_am");
  for (const i of inv) lines.push(`Rechnung;${i.number};${i.ref};${de(i.amount_cents)};${i.status};${i.dunning_level};${i.due_date};${iso(i.paid_at)}`);
  for (const p of pay) lines.push(`Zahlung;;${p.ref};${de(p.amount_cents)};${p.method};;;;${iso(p.paid_at)}`);
  const csv = "\uFEFF" + lines.join("\r\n"); // BOM → Excel UTF-8
  await audit(db, user.id, "csv_export", "invoice", "", `rows=${lines.length - 1}`);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="finanz-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
