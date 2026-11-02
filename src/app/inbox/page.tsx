import { connection } from "next/server";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { Metadata } from "next";

export const instant = false;
export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Инбокс" };

const ROLE_LABEL: Record<string, string> = {
  kunde: "Клиент",
  logist: "Логист",
  driver: "Водитель",
  finance: "Бухгалтер",
  admin: "Админ",
};

export default async function InboxPage() {
  await connection();
  await requireRole(["logist", "admin"], "/inbox");
  const db = await getDb();

  const res = await db.execute({
    sql: `SELECT m.id, m.body, m.created_at, m.from_email, o.ref, o.from_text, o.to_text
      FROM messages m JOIN orders o ON o.id = m.order_id
      WHERE m.from_role = 'kunde' AND m.read_at IS NULL
      ORDER BY m.created_at DESC LIMIT 100`,
  });
  const unread = res.rows as unknown as
    Array<{ id: number; body: string; created_at: number; from_email: string; ref: string; from_text: string; to_text: string }>;

  const allRes = await db.execute({
    sql: `SELECT o.ref, o.status,
        (SELECT COUNT(*) FROM messages m WHERE m.order_id = o.id AND m.from_role = 'kunde') AS client_msgs,
        (SELECT MAX(m.created_at) FROM messages m WHERE m.order_id = o.id) AS last_at
      FROM orders o
      WHERE EXISTS (SELECT 1 FROM messages m WHERE m.order_id = o.id)
      ORDER BY last_at DESC LIMIT 50`,
  });
  const threads = allRes.rows as unknown as
    Array<{ ref: string; status: string; client_msgs: number; last_at: number }>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Инбокс</h1>
      <p className="mt-1 text-sm text-muted">Непрочитанные сообщения клиентов и все переписки по заявкам.</p>

      <h2 className="mt-6 font-semibold">Непрочитанные ({unread.length})</h2>
      {unread.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Всё прочитано.</p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {unread.map((m) => (
            <li key={m.id} className="card p-4">
              <p className="text-sm">
                <Link className="font-semibold text-accent underline" href={`/order/${m.ref}`}>{m.ref}</Link>
                {" · "}{m.from_email} · {new Date(m.created_at * 1000).toLocaleString("de-DE")}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
              <p className="mt-1 text-xs text-muted">{m.from_text} → {m.to_text}</p>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 font-semibold">Все переписки</h2>
      {threads.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Сообщений пока нет.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {threads.map((t) => (
            <li key={t.ref} className="card flex items-center justify-between p-3 text-sm">
              <Link className="font-semibold text-accent underline" href={`/order/${t.ref}`}>{t.ref}</Link>
              <span className="text-muted">сообщений: {t.client_msgs}</span>
              <span className="text-muted">{new Date(t.last_at * 1000).toLocaleString("de-DE")}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-xs text-muted">Роль автора видна на странице заявки ({ROLE_LABEL.kunde} и др.). Ответ клиенту — прямо в переписке на странице заявки.</p>
    </main>
  );
}
