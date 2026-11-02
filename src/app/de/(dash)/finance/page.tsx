// DE-зеркало бухгалтерии (Э6, D7): дашборд, реестр счетов, платежи, дуннинг, претензии.
// Общие server actions, тексты co-located.

import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  recordPaymentAction, dunningRefreshAction, createClaimAction, updateClaimStatusAction,
  type PaymentInput,
} from "@/lib/actions";
import { ActionRequired, type ActionItem } from "@/components/action-required";

export const instant = false;

const EUR = (cents: number): string =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);

const INV_STATUS: Record<string, { label: string; chip: string }> = {
  open: { label: "Offen", chip: "chip-dispatched" },
  paid: { label: "Bezahlt", chip: "chip-trust" },
  overdue: { label: "Überfällig", chip: "chip-delayed" },
  in_review: { label: "In Prüfung", chip: "chip" },
  cancelled: { label: "Storniert", chip: "chip-neutral" },
};

const CLAIM_STATUS: Record<string, string> = {
  new: "Neu", in_review: "In Prüfung", offer: "Angebot", resolved: "Bereinigt", rejected: "Abgelehnt",
};

const METHODS = ["sepa", "card", "cash", "paypal", "klarna"] as const;
const METHOD_LABEL: Record<string, string> = { sepa: "SEPA", card: "Karte", cash: "Bar", paypal: "PayPal", klarna: "Klarna" };

type InvRow = { number: string; order_id: number; amount_cents: number; status: string; dunning_level: number; due_date: string; paid_at: number | null; ref: string; client_name: string; gross_cents: number };
type ClaimRow = { number: string; order_id: number; item: string; amount_cents: number; status: string; resolution: string; created_at: number; ref: string };

/** Обёртки-экшены под <form action> (принимают FormData). */
async function paymentForm(fd: FormData): Promise<void> {
  "use server";
  const input: PaymentInput = {
    orderId: Number(fd.get("orderId")),
    amountCents: Math.round(Number(String(fd.get("amount")).replace(",", ".")) * 100),
    method: (String(fd.get("method")) || "sepa") as PaymentInput["method"],
    note: String(fd.get("note") ?? ""),
  };
  await recordPaymentAction(input);
}
async function dunningForm(): Promise<void> {
  "use server";
  await dunningRefreshAction();
}
async function claimForm(fd: FormData): Promise<void> {
  "use server";
  await createClaimAction({
    orderId: Number(fd.get("orderId")),
    item: String(fd.get("item") ?? ""),
    amountCents: Math.round(Number(String(fd.get("amount")).replace(",", ".")) * 100),
  });
}
async function claimStatusForm(fd: FormData): Promise<void> {
  "use server";
  await updateClaimStatusAction(String(fd.get("claimNumber")), String(fd.get("status")));
}

export default async function FinancePage() {
  await connection();
  const user = await requireRole(["finance", "admin"], "/de/finance");
  const db = await getDb();

  const invoicesRes = await db.execute(
    `SELECT i.number, i.order_id, i.amount_cents, i.status, i.dunning_level, i.due_date, i.paid_at,
            o.ref, o.contact_name AS client_name, o.gross_cents
       FROM invoices i JOIN orders o ON o.id = i.order_id
      ORDER BY i.number DESC`,
  );
  const invoices = invoicesRes.rows as unknown as InvRow[];

  const ordersNoInvoiceRes = await db.execute(
    `SELECT o.id, o.ref, o.contact_name, o.gross_cents, o.status
       FROM orders o
      WHERE o.status = 'closed' AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
      ORDER BY o.id DESC`,
  );
  const ordersNoInvoice = ordersNoInvoiceRes.rows as unknown as Array<{ id: number; ref: string; contact_name: string; gross_cents: number; status: string }>;

  const allOrdersRes = await db.execute("SELECT id, ref, contact_name FROM orders WHERE status IN ('closed','acceptance') ORDER BY id DESC");
  const allOrders = allOrdersRes.rows as unknown as
    Array<{ id: number; ref: string; contact_name: string }>;

  const claimsRes = await db.execute(
    `SELECT c.number, c.order_id, c.item, c.amount_cents, c.status, c.resolution, c.created_at, o.ref
       FROM claims c JOIN orders o ON o.id = c.order_id ORDER BY c.number DESC`,
  );
  const claims = claimsRes.rows as unknown as ClaimRow[];

  const paymentsAllRes = await db.execute(
    `SELECT p.*, o.ref FROM payments p JOIN orders o ON o.id = p.order_id ORDER BY p.id DESC LIMIT 50`,
  );
  const paymentsAll = paymentsAllRes.rows as unknown as Array<{ id: number; order_id: number; invoice_id: string | null; amount_cents: number; method: string; paid_at: number; note: string; ref: string }>;

  // Сумма платежей одним запросом (paid по каждому order_id)
  const paidByOrderMap = new Map<number, number>();
  {
    const sumRes = await db.execute("SELECT order_id, COALESCE(SUM(amount_cents),0) AS s FROM payments GROUP BY order_id");
    for (const r of sumRes.rows as unknown as Array<{ order_id: number; s: number }>) {
      paidByOrderMap.set(Number(r.order_id), Number(r.s));
    }
  }
  const paidByOrder = (orderId: number): number => paidByOrderMap.get(orderId) ?? 0;

  // Выплаты партнёрам (субподрядчики)
  const subPayRes = await db.execute(
    `SELECT os.order_id, os.cost_cents, os.move_date, s.name, o.ref
       FROM order_subcontractors os
       JOIN subcontractors s ON s.id = os.sub_id
       JOIN orders o ON o.id = os.order_id
      ORDER BY os.order_id DESC`,
  );
  const subPayments = subPayRes.rows as unknown as Array<{ order_id: number; cost_cents: number; move_date: string; name: string; ref: string }>;
  const subTotal = subPayments.reduce((acc, r) => acc + Number(r.cost_cents), 0);

  // Дашборд (D7.10)
  let openSum = 0, overdueSum = 0, revenue = 0;
  for (const inv of invoices) {
    const paid = paidByOrder(inv.order_id);
    if (inv.status !== "cancelled" && inv.paid_at === null) {
      const rest = Math.max(0, inv.amount_cents - paid);
      openSum += rest;
      if (inv.status === "overdue") overdueSum += rest;
    }
  }
  const revenueRes = await db.execute("SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE amount_cents > 0");
  revenue = Number((revenueRes.rows[0] as unknown as { s: number }).s);

  const dateLabel = (iso: string): string => new Date(`${iso}T12:00:00`).toLocaleDateString("de-DE");
  const tsLabel = (ts: number): string => new Date(ts * 1000).toLocaleDateString("de-DE");
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Buchhaltung</h1>
      <p className="mb-6 text-sm text-muted">
        {user.name} · Rechnungen, Zahlungen, Mahnwesen, Beanstandungen ·{" "}
        <Link className="text-accent underline" href="/de/analytics">Analytik →</Link>
      </p>

      <ActionRequired items={(() => {
        const todayIso = new Date().toISOString().slice(0, 10);
        const finActions: ActionItem[] = [];
        for (const inv of invoices) {
          if (inv.status === "overdue") {
            finActions.push({ key: `dun-${inv.number}`, label: `Rechnung ${EUR(inv.amount_cents)} überfällig — Mahnwesen starten`, href: "/de/finance", tag: inv.number, urgent: true });
          } else if (inv.status === "open" && inv.due_date < todayIso) {
            finActions.push({ key: `od-${inv.number}`, label: `Rechnung über Fälligkeit (${EUR(inv.amount_cents)}) — Mahnwesen aktualisieren`, href: "/de/finance", tag: inv.number });
          }
        }
        for (const o of ordersNoInvoice) {
          finActions.push({ key: `inv-${o.ref}`, label: "Abgeschlossen, keine Rechnung erstellt", href: "/de/finance", tag: o.ref, urgent: true });
        }
        return finActions;
      })()} title="Finanzaufgaben" />

      {/* Дашборд */}
      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Zu erhalten", value: EUR(openSum) },
          { label: "Überfällig", value: EUR(overdueSum) },
          { label: "Eingänge", value: EUR(revenue) },
          { label: "Rechnungen", value: String(invoices.length) },
        ].map((c) => (
          <div key={c.label} className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink">{c.label}</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{c.value}</div>
          </div>
        ))}
      </section>

      {/* Закрытые заказы без счёта (D7.1) */}
      {ordersNoInvoice.length > 0 && (
        <section className="card mb-8 p-4">
          <h2 className="mb-2 font-semibold">Abgeschlossene Aufträge ohne Rechnung</h2>
          <ul className="divide-y divide-line">
            {ordersNoInvoice.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  <Link href={`/de/order/${o.ref}`} className="font-medium underline">{o.ref}</Link>
                  <span className="text-sm text-muted"> · {o.contact_name} · {EUR(o.gross_cents)}</span>
                </span>
                <span className="chip">wartet auf Rechnung — wird automatisch erstellt</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Die Rechnung wird beim Abschluss des Auftrags durch den Disponenten erstellt (Status „Abnahme“ → „Abgeschlossen“).</p>
        </section>
      )}

      {/* Реестр счетов */}
      <section className="card mb-8 overflow-x-auto p-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-semibold">Rechnungsregister</h2>
          <div className="flex gap-2">
            <a href="/api/finance/csv" className="btn btn-outline px-3 py-1.5 text-sm">CSV-Export</a>
            <form action={dunningForm}>
              <button type="submit" className="btn btn-secondary px-3 py-1.5 text-sm">Mahnwesen aktualisieren</button>
            </form>
          </div>
        </div>
        {invoices.length === 0 ? (
          <p className="py-4 text-sm font-medium text-ink">Noch keine Rechnungen — sie erscheinen nach dem ersten abgeschlossenen Auftrag.</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2">Rechnung</th><th>Auftrag</th><th>Kunde</th><th className="tabular-nums">Betrag</th>
                <th className="tabular-nums">Bezahlt</th><th>Status</th><th>Fällig</th><th>Zahlung</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const paid = paidByOrder(inv.order_id);
                const rest = inv.amount_cents - paid;
                const isPaid = inv.paid_at !== null || (paid >= inv.amount_cents && inv.amount_cents > 0 && paid > 0);
                const st = isPaid ? { label: "Bezahlt", chip: "chip-trust" } : (INV_STATUS[inv.status] ?? { label: inv.status, chip: "chip" });
                return (
                  <tr key={inv.number} className="border-b border-line">
                    <td className="py-2 font-medium">
                      {inv.number}
                      <a href={`/api/pdf/invoice/${inv.number}`} target="_blank" rel="noopener" className="ml-1 text-xs text-accent underline" aria-label={`PDF ${inv.number}`}>PDF</a>
                    </td>
                    <td><Link href={`/de/order/${inv.ref}`} className="underline">{inv.ref}</Link></td>
                    <td>{inv.client_name}</td>
                    <td className="tabular-nums">{EUR(inv.amount_cents)}</td>
                    <td className="tabular-nums">{EUR(paid)}{rest > 0 && inv.status !== "cancelled" ? <span className="text-xs text-muted"> (−{EUR(rest)})</span> : null}</td>
                    <td><span className={`chip ${st.chip}`}>{st.label}{!isPaid && inv.dunning_level > 0 ? ` · M${inv.dunning_level}` : ""}</span></td>
                    <td className="tabular-nums">{dateLabel(inv.due_date)}</td>
                    <td>
                      {inv.status !== "cancelled" && !isPaid && rest > 0 ? (
                        <form action={paymentForm} className="flex flex-wrap items-center gap-1">
                          <input type="hidden" name="orderId" value={inv.order_id} />
                          <input className="input-base w-24 px-2 py-1 text-sm" name="amount" placeholder={(rest / 100).toFixed(2)} defaultValue="" inputMode="decimal" required />
                          <select className="input-base w-20 px-1 py-1 text-sm" name="method" defaultValue="sepa">
                            {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                          </select>
                          <button type="submit" className="btn btn-primary px-2 py-1 text-xs">Erfassen</button>
                        </form>
                      ) : paid > 0 ? (
                        <RefundForm orderId={inv.order_id} paid={paid} />
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted">Als bezahlt gilt eine Rechnung, wenn die Zahlungssumme ≥ Rechnungsbetrag ist. Erstattung — negativer Betrag mit Anmerkung. Mahnstufen: Stufe 1 &gt; 14 Tage, Stufe 2 &gt; 30 Tage (§ 288 BGB — Verzugszinsen).</p>
      </section>

      {/* Платежи (журнал) */}
      <section className="card mb-8 overflow-x-auto p-4">
        <h2 className="mb-3 font-semibold">Zahlungsjournal</h2>
        {paymentsAll.length === 0 ? (
          <p className="py-2 text-sm text-muted">Noch keine Zahlungen.</p>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2">Datum</th><th>Auftrag</th><th>Rechnung</th><th className="tabular-nums">Betrag</th><th>Art</th><th>Anmerkung</th>
              </tr>
            </thead>
            <tbody>
              {paymentsAll.map((p) => (
                <tr key={p.id} className="border-b border-line">
                  <td className="py-2 tabular-nums">{tsLabel(p.paid_at)}</td>
                  <td><Link href={`/de/order/${p.ref}`} className="underline">{p.ref}</Link></td>
                  <td>{p.invoice_id ?? "Anzahlung"}</td>
                  <td className={`tabular-nums ${p.amount_cents < 0 ? "text-danger" : ""}`}>{EUR(p.amount_cents)}</td>
                  <td>{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td className="text-xs text-muted">{p.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Выплаты партнёрам (субподрядчики) */}
      <section className="card mb-8 overflow-x-auto p-4">
        <h2 className="mb-3 font-semibold">Partnerauszahlungen (Subunternehmer)</h2>
        {subPayments.length === 0 ? (
          <p className="py-2 text-sm text-muted">Noch keine Partnerauszahlungen.</p>
        ) : (
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2">Auftrag</th><th>Partner</th><th>Umzugsdatum</th><th className="tabular-nums">Auszahlbar</th>
              </tr>
            </thead>
            <tbody>
              {subPayments.map((r) => (
                <tr key={r.order_id} className="border-b border-line">
                  <td className="py-2"><Link href={`/de/order/${r.ref}`} className="underline">{r.ref}</Link></td>
                  <td>{r.name}</td>
                  <td className="tabular-nums">{r.move_date ? dateLabel(r.move_date) : "—"}</td>
                  <td className="tabular-nums">{EUR(r.cost_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={3} className="py-2 text-right">Gesamt an Partner:</td>
                <td className="tabular-nums">{EUR(subTotal)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      {/* Претензии */}
      <section className="card mb-8 overflow-x-auto p-4">
        <h2 className="mb-3 font-semibold">Beanstandungen</h2>
        {claims.length === 0 ? (
          <p className="py-2 text-sm text-muted">Keine Beanstandungen.</p>
        ) : (
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2">Nr.</th><th>Auftrag</th><th>Gegenstand</th><th className="tabular-nums">Betrag</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.number} className="border-b border-line">
                  <td className="py-2 font-medium">{c.number}</td>
                  <td><Link href={`/de/order/${c.ref}`} className="underline">{c.ref}</Link></td>
                  <td>{c.item}</td>
                  <td className="tabular-nums">{EUR(c.amount_cents)}</td>
                  <td>
                    <form action={claimStatusForm} className="flex items-center gap-1">
                      <input type="hidden" name="claimNumber" value={c.number} />
                      <select className="input-base px-2 py-1 text-sm" name="status" defaultValue={c.status}>
                        {Object.entries(CLAIM_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <button type="submit" className="btn btn-secondary px-2 py-1 text-xs">Speichern</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {allOrders.length > 0 && (
          <form action={claimForm} className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-muted" htmlFor="claim-order">Auftrag</label>
              <select id="claim-order" className="input-base w-48 px-2 py-1 text-sm" name="orderId" defaultValue={String(allOrders[0]?.id ?? "")}>
                {allOrders.map((o) => <option key={o.id} value={o.id}>{o.ref} · {o.contact_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted" htmlFor="claim-item">Gegenstand</label>
              <input id="claim-item" className="input-base w-48 px-2 py-1 text-sm" name="item" maxLength={200} required />
            </div>
            <div>
              <label className="block text-xs text-muted" htmlFor="claim-amount">Betrag, €</label>
              <input id="claim-amount" className="input-base w-28 px-2 py-1 text-sm" name="amount" inputMode="decimal" required />
            </div>
            <button type="submit" className="btn btn-primary px-3 py-1.5 text-sm">Beanstandung erfassen</button>
          </form>
        )}
        <p className="mt-2 text-xs text-muted">Entschädigung pro Beanstandung — negative Zahlung (Erstattung) im Rechnungsregister mit SC-Nummer als Anmerkung.</p>
      </section>

      <p className="text-xs text-muted">Demo-Umgebung: heute {todayIso}. Nummerierung RE-JJJJ-0NNN fortlaufend (GoBD), eine stornierte Rechnung behält ihre Nummer.</p>
    </>
  );
}

/** Компактная форма возврата (D7.4): отрицательная сумма + обязательное примечание. */
function RefundForm({ orderId, paid }: { orderId: number; paid: number }) {
  return (
    <form action={paymentForm} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input className="input-base w-24 px-2 py-1 text-sm" name="amount" placeholder={`-${(paid / 100).toFixed(2)}`} defaultValue="" inputMode="decimal" required />
      <select className="input-base w-20 px-1 py-1 text-sm" name="method" defaultValue="sepa">
        {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
      </select>
      <input className="input-base w-36 px-2 py-1 text-sm" name="note" placeholder="SC-Nummer, Grund" defaultValue="" required />
      <button type="submit" className="btn btn-outline px-2 py-1 text-xs">Erstattung</button>
    </form>
  );
}
