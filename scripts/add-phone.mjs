// Миграция: колонка phone у users (телефон клиента при регистрации).
// Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/add-phone.mjs
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) {
  console.error("Need TURSO_DATABASE_URL + TURSO_AUTH_TOKEN");
  process.exit(1);
}

const db = createClient({ url, authToken: token });

const info = await db.execute("PRAGMA table_info(users)");
const cols = info.rows.map((r) => String(r.name));
console.log("users cols before:", cols.join(", "));

if (cols.includes("phone")) {
  console.log("phone column already exists — skip");
} else {
  await db.execute(
    `ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''`,
  );
  console.log("ADDED phone column");
}

const check = await db.execute("PRAGMA table_info(users)");
console.log("users cols after:", check.rows.map((r) => String(r.name)).join(", "));
