// Одноразовый фикс: вставить недостающих демо-юзеров (users уже содержит klient).
import { createClient } from "@libsql/client";
import { randomBytes, scryptSync } from "node:crypto";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, Buffer.from(salt, "hex"), 32);
  return `${salt}:${hash.toString("hex")}`;
}

const missing = [
  ["logist@example.com", "Сергей Волков", "logist"],
  ["voditel@example.com", "Мурат Джан", "driver"],
  ["voditel2@example.com", "Окан Еылмаз", "driver"],
  ["buh@example.com", "Петра Андерс", "finance"],
  ["admin@example.com", "Маркус Фогель", "admin"],
];

const now = Math.floor(Date.now() / 1000);
const hash = hashPassword("demo1234");
for (const [email, name, role] of missing) {
  await db.execute({
    sql: "INSERT OR IGNORE INTO users (email, name, role, password_hash, active, email_verified, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)",
    args: [email, name, role, hash, now],
  });
}
const r = await db.execute("SELECT email, role FROM users");
console.log(r.rows.map((row) => `${row.email} (${row.role})`).join("\n"));
console.log("USERS_FIXED");
