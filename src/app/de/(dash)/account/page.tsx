// Kundenkonto (DE-зеркало /account): список заявок + ссылка на калькулятор.

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { DeleteAccountDe } from "@/components/delete-account-de";
import { ChangeEmailDe } from "@/components/change-email-de";
import { ActionRequired, type ActionItem } from "@/components/action-required";

export const metadata: Metadata = { title: "Kundenkonto", robots: { index: false } };
export const instant = false;

const STATUS_LABEL: Record<string, string> = {
  new: "Neue Anfrage",
  confirmed: "Bestätigt",
  assigned: "Fahrzeug zugewiesen",
  enroute: "Unterwegs",
  acceptance: "Abnahme",
  closed: "Abschlossen",
  cancelled: "Storniert",
};

function fmt(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function AccountPageDe() {
  await connection(); // Route uses DB time (Date.now in findSession) — render at request time
  const user = await requireUser("/de/account");
  const db = await getDb();
  const ordersRes = await db.execute({
    sql: "SELECT ref, status, move_date, from_text, to_text, gross_cents FROM orders WHERE client_id = ? ORDER BY id DESC",
    args: [user.id],
  });
  const orders = ordersRes.rows as unknown as Array<{ ref: string; status: string; move_date: string; from_text: string; to_text: string; gross_cents: number }>;

  // ── Panel «Erfordert Ihre Aktion»: offene Vorgänge des Kunden ──
  const todayIso = new Date().toISOString().slice(0, 10);
  function addDaysIso(iso: string, n: number): string {
    const x = new Date(iso + "T12:00:00Z");
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  }
  const actions: ActionItem[] = [];
  for (const o of orders) {
    if (o.status === "acceptance") {
      actions.push({ key: `acc-${o.ref}`, label: "Umzugsabnahme bestätigen", href: `/de/order/${o.ref}`, tag: o.ref, urgent: true });
    } else if (o.status === "closed") {
      // Rechnung nicht vollständig bezahlt?
      const paidRes = await db.execute({
        sql: "SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE order_id = (SELECT id FROM orders WHERE ref = ?)",
        args: [o.ref],
      });
      const paid = Number((paidRes.rows[0] as unknown as { s: number }).s);
      if (paid < o.gross_cents) {
        actions.push({ key: `pay-${o.ref}`, label: `Rechnung bezahlen (Restbetrag ${fmt(o.gross_cents - paid)})`, href: `/de/order/${o.ref}`, tag: o.ref });
      }
    }
    if (o.status !== "closed" && o.status !== "cancelled" && o.move_date <= todayIso) {
      actions.push({ key: `mv-${o.ref}`, label: "Umzug heute — Status im Auge behalten", href: `/de/order/${o.ref}`, tag: o.ref, urgent: true });
    }
    // 48h-Fokus: neue Anfrage mit Umzug in den nächsten 48 Stunden
    if (o.status === "new" && o.move_date > todayIso && o.move_date <= addDaysIso(todayIso, 2)) {
      actions.push({ key: `conf48-${o.ref}`, label: "Umzug in ≤48 Stunden — Anfrage noch nicht bestätigt", href: `/de/order/${o.ref}`, tag: o.ref, urgent: true });
    }
  }
  // ausstehende Preisänderung, die auf die Entscheidung des Kunden wartet
  const pending = orders.find((o) => o.status === "confirmed" || o.status === "assigned");
  if (pending) {
    const pRes = await db.execute({
      sql: "SELECT ref, pending_snapshot FROM orders WHERE ref = ? AND pending_snapshot IS NOT NULL",
      args: [pending.ref],
    });
    if (pRes.rows.length > 0) {
      actions.push({ key: `rev-${pending.ref}`, label: "Disponent schlug Preisänderung vor — bestätigen oder ablehnen", href: `/de/order/${pending.ref}`, tag: pending.ref, urgent: true });
    }
  }

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold sm:text-3xl">Kundenkonto</h1>
      <p className="mb-6 text-muted">{user.name} · {user.email}</p>

      <ActionRequired items={actions} locale="de" />

      <div className="mb-8 flex flex-wrap gap-3">
        <Link className="btn btn-primary" href="/de/calc">Umzug berechnen</Link>
        <form action="/api/logout" method="post">
          <button className="btn btn-outline" type="submit">Abmelden</button>
        </form>
      </div>

      <div className="mb-8 card p-4">
        <h2 className="mb-2 font-semibold">Meine Daten (Art. 15 DSGVO)</h2>
        <p className="mb-2 text-sm text-muted">
          Laden Sie alle Ihre Daten im JSON-Format herunter: Profil, Anfragen, Dokumente, Zahlungen.
        </p>
        <a className="btn btn-outline" href="/api/account/export" download>JSON-Export</a>
        <h2 className="mt-5 mb-1 font-semibold">E-Mail ändern</h2>
        <ChangeEmailDe currentEmail={user.email} />
      </div>

      <h2 className="mb-3 font-semibold">Meine Anfragen</h2>
      {orders.length === 0 ? (
        <div className="card p-6 text-sm text-muted">
          Noch keine Anfragen. <Link className="text-accent underline" href="/de/calc">Berechnen Sie Ihren Umzug</Link> — die Anfrage dauert eine Minute.
        </div>
      ) : (
        <ul className="grid gap-3">
          {orders.map((o) => (
            <li key={o.ref} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link className="font-semibold text-accent hover:underline" href={`/de/order/${o.ref}`}>{o.ref}</Link>
                <span className="rounded-full bg-surface-2 px-3 py-1 text-xs">{STATUS_LABEL[o.status] ?? o.status}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{o.from_text} → {o.to_text}</p>
              <p className="text-sm text-muted">Datum: {o.move_date} · Gesamt: {fmt(o.gross_cents)}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <DeleteAccountDe />
      </div>
    </>
  );
}
