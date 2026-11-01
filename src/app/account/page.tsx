// Личный кабинет клиента (Э3): список заявок + ссылка на калькулятор.

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

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
  const db = getDb();
  const ordersRes = await db.execute({
    sql: "SELECT ref, status, move_date, from_text, to_text, gross_cents FROM orders WHERE client_id = ? ORDER BY id DESC",
    args: [user.id],
  });
  const orders = ordersRes.rows as unknown as Array<{ ref: string; status: string; move_date: string; from_text: string; to_text: string; gross_cents: number }>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold sm:text-3xl">Личный кабинет</h1>
      <p className="mb-6 text-muted">{user.name} · {user.email}</p>

      <div className="mb-8 flex flex-wrap gap-3">
        <Link className="btn btn-primary" href="/calc">Рассчитать переезд</Link>
        <form action="/api/logout" method="post">
          <button className="btn btn-outline" type="submit">Выйти</button>
        </form>
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
    </main>
  );
}
