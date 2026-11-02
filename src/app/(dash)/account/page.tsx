// Личный кабинет клиента (Э3): список заявок + ссылка на калькулятор.

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { DeleteAccount } from "./delete-account";
import { ChangeEmail } from "./change-email";
import { ActionRequired, type ActionItem } from "@/components/action-required";

export const metadata: Metadata = { title: "Личный кабинет", robots: { index: false } };
export const instant = false;

const STATUS_LABEL: Record<string, string> = {
  new: "Новая заявка",
  confirmed: "Подтверждена",
  assigned: "Машина назначена",
  enroute: "В пути",
  acceptance: "Приёмка",
  closed: "Закрыт",
  cancelled: "Отменён",
};

function fmt(cents: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function AccountPage() {
  await connection(); // Route uses DB time (Date.now in findSession) — render at request time
  const user = await requireUser("/account");
  const db = await getDb();
  const ordersRes = await db.execute({
    sql: "SELECT ref, status, move_date, from_text, to_text, gross_cents FROM orders WHERE client_id = ? ORDER BY id DESC",
    args: [user.id],
  });
  const orders = ordersRes.rows as unknown as Array<{ ref: string; status: string; move_date: string; from_text: string; to_text: string; gross_cents: number }>;

  // ── Панель «Требует вашего действия»: незаконченные операции клиента ──
  const todayIso = new Date().toISOString().slice(0, 10);
  const actions: ActionItem[] = [];
  for (const o of orders) {
    if (o.status === "acceptance") {
      actions.push({ key: `acc-${o.ref}`, label: "Подтвердить приёмку переезда", href: `/order/${o.ref}`, tag: o.ref, urgent: true });
    } else if (o.status === "closed") {
      // счёт не оплачен полностью?
      const paidRes = await db.execute({
        sql: "SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE order_id = (SELECT id FROM orders WHERE ref = ?)",
        args: [o.ref],
      });
      const paid = Number((paidRes.rows[0] as unknown as { s: number }).s);
      if (paid < o.gross_cents) {
        actions.push({ key: `pay-${o.ref}`, label: `Оплатить счёт (остаток ${fmt(o.gross_cents - paid)})`, href: `/order/${o.ref}`, tag: o.ref });
      }
    }
    if (o.status !== "closed" && o.status !== "cancelled" && o.move_date <= todayIso) {
      actions.push({ key: `mv-${o.ref}`, label: "Переезд сегодня — следите за статусом", href: `/order/${o.ref}`, tag: o.ref, urgent: true });
    }
  }
  // активная правка цены, ждущая решения клиента
  const pending = orders.find((o) => o.status === "confirmed" || o.status === "assigned");
  if (pending) {
    const pRes = await db.execute({
      sql: "SELECT ref, pending_snapshot FROM orders WHERE ref = ? AND pending_snapshot IS NOT NULL",
      args: [pending.ref],
    });
    if (pRes.rows.length > 0) {
      actions.push({ key: `rev-${pending.ref}`, label: "Логист предложил изменение цены — подтвердите или отклоните", href: `/order/${pending.ref}`, tag: pending.ref, urgent: true });
    }
  }

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold sm:text-3xl">Личный кабинет</h1>
      <p className="mb-6 text-muted">{user.name} · {user.email}</p>

      <ActionRequired items={actions} />

      <div className="mb-8 flex flex-wrap gap-3">
        <Link className="btn btn-primary" href="/calc">Рассчитать переезд</Link>
        <form action="/api/logout" method="post">
          <button className="btn btn-outline" type="submit">Выйти</button>
        </form>
      </div>

      <div className="mb-8 card p-4">
        <h2 className="mb-2 font-semibold">Мои данные (ст. 15 DSGVO)</h2>
        <p className="mb-2 text-sm text-muted">
          Скачайте все ваши данные в формате JSON: профиль, заявки, документы, платежи.
        </p>
        <a className="btn btn-outline" href="/api/account/export" download>Экспорт JSON</a>
        <h2 className="mt-5 mb-1 font-semibold">Смена email</h2>
        <ChangeEmail currentEmail={user.email} />
      </div>

      <h2 className="mb-3 font-semibold">Мои заявки</h2>
      {orders.length === 0 ? (
        <div className="card p-6 text-sm text-muted">
          Пока заявок нет. <Link className="text-accent underline" href="/calc">Рассчитайте переезд</Link> — заявка займёт минуту.
        </div>
      ) : (
        <ul className="grid gap-3">
          {orders.map((o) => (
            <li key={o.ref} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link className="font-semibold text-accent hover:underline" href={`/order/${o.ref}`}>{o.ref}</Link>
                <span className="rounded-full bg-surface-2 px-3 py-1 text-xs">{STATUS_LABEL[o.status] ?? o.status}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{o.from_text} → {o.to_text}</p>
              <p className="text-sm text-muted">Дата: {o.move_date} · Итого: {fmt(o.gross_cents)}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <DeleteAccount />
      </div>
    </>
  );
}
