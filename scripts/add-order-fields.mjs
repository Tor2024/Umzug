// Идемпотентная миграция: start_time/self_pack/special_requests/special_approved в orders.
// Запуск: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/add-order-fields.mjs
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) { console.error("Need TURSO_DATABASE_URL + TURSO_AUTH_TOKEN"); process.exit(1); }
const db = createClient({ url, authToken: token });

const needed = [
  ["start_time", "TEXT NOT NULL DEFAULT ''"],
  ["self_pack", "INTEGER NOT NULL DEFAULT 0"],
  ["special_requests", "TEXT"],
  ["special_approved", "INTEGER"],
];
const info = await db.execute("PRAGMA table_info(orders)");
const have = new Set(info.rows.map((r) => String(r.name)));
for (const [col, ddl] of needed) {
  if (have.has(col)) { console.log("SKIP", col); continue; }
  await db.execute(`ALTER TABLE orders ADD COLUMN ${col} ${ddl}`);
  console.log("ADDED", col);
}
console.log("ORDER FIELDS OK");
