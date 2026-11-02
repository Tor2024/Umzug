// Миграция: таблица messages (задача 9 — инбокс входящих ответов).
// Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/add-messages-table.mjs
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) {
  console.error("Need TURSO_DATABASE_URL + TURSO_AUTH_TOKEN");
  process.exit(1);
}

const db = createClient({ url, authToken: token });

const stmts = [
  `CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES orders(id),
    from_role  TEXT NOT NULL CHECK (from_role IN ('kunde','logist','driver','finance','admin')),
    from_user_id INTEGER,
    from_email TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL,
    read_at    INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id, created_at)`,
];

await db.batch(stmts.map((sql) => ({ sql, args: [] })), "write");
console.log("MESSAGES TABLE OK");

const check = await db.execute("SELECT COUNT(*) AS n FROM messages");
console.log("messages rows:", Number(check.rows[0].n));
