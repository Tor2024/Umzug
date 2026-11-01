// Бухгалтерия (Э6, D7): дашборд, реестр счетов, платежи, дуннинг, претензии.
// Источник денежной правды — payments (D2); paid счёта = деривация.

import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  recordPaymentAction, dunningRefreshAction, createClaimAction, updateClaimStatusAction,
  type PaymentInput,
} from "@/lib/actions";

export const instant = false;

const EUR = (cents: number): string =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "EUR" }).format(cents / 100);

const INV_STATUS: Record<string, { label: string; chip: string }> = {
  open: { label: "Открыт", chip: "chip-dispatched" },
  paid: { label: "Оплачен", chip: "chip-trust" },
  overdue: { label: "Просрочен", chip: "chip-delayed" },
  in_review: { label: "На проверке", chip: "chip" },
  cancelled: { label: "Аннулирован", chip: "chip-neutral" },
};

const CLAIM_STATUS: Record<string, string> = {
  new: "Новая", in_review: "На рассмотрении", offer: "Предложение", resolved: "Урегулирована", rejected: "Отклонена",
};

const METHODS = ["sepa", "card", "cash", "paypal", "klarna"] as const;
const METHOD_LABEL: Record<string, string> = { sepa: "SEPA", card: "Карта", cash: "Наличные", paypal: "PayPal", klarna: "Klarna" };

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
  const user = await requireRole(["finance", "admin"], "/finance");
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

  const dateLabel = (iso: string): string => new Date(`${iso}T12:00:00`).toLocaleDateString("ru-RU");
  const tsLabel = (ts: number): string => new Date(ts * 1000).toLocaleDateString("ru-RU");
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Бухгалтерия</h1>
      <p className="mb-6 text-sm text-muted">{user.name} · счета, платежи, дуннинг, претензии</p>

      {/* Дашборд */}
      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "К получению", value: EUR(openSum) },
          { label: "Просрочено", value: EUR(overdueSum) },
          { label: "Поступления", value: EUR(revenue) },
          { label: "Счетов", value: String(invoices.length) },
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
          <h2 className="mb-2 font-semibold">Закрытые заказы без счёта</h2>
          <ul className="divide-y divide-line">
            {ordersNoInvoice.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  <Link href={`/order/${o.ref}`} className="font-medium underline">{o.ref}</Link>
                  <span className="text-sm text-muted"> · {o.contact_name} · {EUR(o.gross_cents)}</span>
                </span>
                <span className="chip">ожидает счёта — счет появится автоматически</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Счёт создаётся при закрытии заказа логистом (статус «Приёмка» → «Закрыт»).</p>
        </section>
      )}

      {/* Реестр счетов */}
      <section className="card mb-8 overflow-x-auto p-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-semibold">Реестр счетов</h2>
          <div className="flex gap-2">
            <a href="/api/finance/csv" className="btn btn-outline px-3 py-1.5 text-sm">Экспорт CSV</a>
            <form action={dunningForm}>
              <button type="submit" className="btn btn-secondary px-3 py-1.5 text-sm">Обновить дуннинг</button>
            </form>
          </div>
        </div>
        {invoices.length === 0 ? (
          <p className="py-4 text-sm font-medium text-ink">Счетов пока нет — они появятся после закрытия первого заказа.</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2">Счёт</th><th>Заказ</th><th>Клиент</th><th className="tabular-nums">Сумма</th>
                <th className="tabular-nums">Оплачено</th><th>Статус</th><th>Срок</th><th>Оплата</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const paid = paidByOrder(inv.order_id);
                const rest = inv.amount_cents - paid;
                const isPaid = inv.paid_at !== null || (paid >= inv.amount_cents && inv.amount_cents > 0 && paid > 0);
                const st = isPaid ? { label: "Оплачен", chip: "chip-trust" } : (INV_STATUS[inv.status] ?? { label: inv.status, chip: "chip" });
                return (
                  <tr key={inv.number} className="border-b border-line">
                    <td className="py-2 font-medium">{inv.number}</td>
                    <td><Link href={`/order/${inv.ref}`} className="underline">{inv.ref}</Link></td>
                    <td>{inv.client_name}</td>
                    <td className="tabular-nums">{EUR(inv.amount_cents)}</td>
                    <td className="tabular-nums">{EUR(paid)}{rest > 0 && inv.status !== "cancelled" ? <span className="text-xs text-muted"> (−{EUR(rest)})</span> : null}</td>
                    <td><span className={`chip ${st.chip}`}>{st.label}{!isPaid && inv.dunning_level > 0 ? ` · М${inv.dunning_level}` : ""}</span></td>
                    <td className="tabular-nums">{dateLabel(inv.due_date)}</td>
                    <td>
                      {inv.status !== "cancelled" && !isPaid && rest > 0 ? (
                        <form action={paymentForm} className="flex flex-wrap items-center gap-1">
                          <input type="hidden" name="orderId" value={inv.order_id} />
                          <input className="input-base w-24 px-2 py-1 text-sm" name="amount" placeholder={(rest / 100).toFixed(2)} defaultValue="" inputMode="decimal" required />
                          <select className="input-base w-20 px-1 py-1 text-sm" name="method" defaultValue="sepa">
                            {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                          </select>
                          <button type="submit" className="btn btn-primary px-2 py-1 text-xs">Внести</button>
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
        <p className="mt-2 text-xs text-muted">Оплаченным счёт считается, когда сумма платежей ≥ суммы счёта. Возврат — отрицательная сумма с примечанием. Дуннинг: уровень 1 &gt; 14 дней, уровень 2 &gt; 30 дней (§ 288 BGB — проценты).</p>
      </section>

      {/* Платежи (журнал) */}
      <section className="card mb-8 overflow-x-auto p-4">
        <h2 className="mb-3 font-semibold">Журнал платежей</h2>
        {paymentsAll.length === 0 ? (
          <p className="py-2 text-sm text-muted">Платежей пока нет.</p>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2">Дата</th><th>Заказ</th><th>Счёт</th><th className="tabular-nums">Сумма</th><th>Способ</th><th>Примечание</th>
              </tr>
            </thead>
            <tbody>
              {paymentsAll.map((p) => (
                <tr key={p.id} className="border-b border-line">
                  <td className="py-2 tabular-nums">{tsLabel(p.paid_at)}</td>
                  <td><Link href={`/order/${p.ref}`} className="underline">{p.ref}</Link></td>
                  <td>{p.invoice_id ?? "аванс"}</td>
                  <td className={`tabular-nums ${p.amount_cents < 0 ? "text-danger" : ""}`}>{EUR(p.amount_cents)}</td>
                  <td>{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td className="text-xs text-muted">{p.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Претензии */}
      <section className="card mb-8 overflow-x-auto p-4">
        <h2 className="mb-3 font-semibold">Претензии</h2>
        {claims.length === 0 ? (
          <p className="py-2 text-sm text-muted">Претензий нет.</p>
        ) : (
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2">Номер</th><th>Заказ</th><th>Предмет</th><th className="tabular-nums">Сумма</th><th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.number} className="border-b border-line">
                  <td className="py-2 font-medium">{c.number}</td>
                  <td><Link href={`/order/${c.ref}`} className="underline">{c.ref}</Link></td>
                  <td>{c.item}</td>
                  <td className="tabular-nums">{EUR(c.amount_cents)}</td>
                  <td>
                    <form action={claimStatusForm} className="flex items-center gap-1">
                      <input type="hidden" name="claimNumber" value={c.number} />
                      <select className="input-base px-2 py-1 text-sm" name="status" defaultValue={c.status}>
                        {Object.entries(CLAIM_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <button type="submit" className="btn btn-secondary px-2 py-1 text-xs">Сохранить</button>
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
              <label className="block text-xs text-muted" htmlFor="claim-order">Заказ</label>
              <select id="claim-order" className="input-base w-48 px-2 py-1 text-sm" name="orderId" defaultValue={String(allOrders[0]?.id ?? "")}>
                {allOrders.map((o) => <option key={o.id} value={o.id}>{o.ref} · {o.contact_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted" htmlFor="claim-item">Предмет</label>
              <input id="claim-item" className="input-base w-48 px-2 py-1 text-sm" name="item" maxLength={200} required />
            </div>
            <div>
              <label className="block text-xs text-muted" htmlFor="claim-amount">Сумма, €</label>
              <input id="claim-amount" className="input-base w-28 px-2 py-1 text-sm" name="amount" inputMode="decimal" required />
            </div>
            <button type="submit" className="btn btn-primary px-3 py-1.5 text-sm">Зарегистрировать претензию</button>
          </form>
        )}
        <p className="mt-2 text-xs text-muted">Компенсация по претензии — отрицательный платёж (возврат) в реестре счетов с примечанием SC-номер.</p>
      </section>

      <p className="text-xs text-muted">Демо-среда: сегодня {todayIso}. Нумерация RE-ГГГГ-0NNN сквозная (GoBD), аннулированный счёт сохраняет номер.</p>
    </main>
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
      <input className="input-base w-36 px-2 py-1 text-sm" name="note" placeholder="SC-номер, причина" defaultValue="" required />
      <button type="submit" className="btn btn-outline px-2 py-1 text-xs">Возврат</button>
    </form>
  );
}
