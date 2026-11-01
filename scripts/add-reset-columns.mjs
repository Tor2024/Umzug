import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Проверяем наличие колонок reset_token/reset_expires и добавляем если нет
const cols = await db.execute("PRAGMA table_info(users)");
const names = cols.rows.map((r) => String(r.name));
console.log("existing columns:", names.join(", "));

if (!names.includes("reset_token")) {
  await db.execute("ALTER TABLE users ADD COLUMN reset_token TEXT");
  console.log("added: reset_token");
}
if (!names.includes("reset_expires")) {
  await db.execute("ALTER TABLE users ADD COLUMN reset_expires INTEGER");
  console.log("added: reset_expires");
}
if (!names.some((n) => n === "idx_users_reset_token")) {
  await db.execute("CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)");
  console.log("added: idx_users_reset_token");
}
console.log("MIGRATION OK");
