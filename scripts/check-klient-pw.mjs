// Проверка/сброс пароля klient@example.com на demo1234 (формат salt:hash, scrypt 32 байта).
import { createClient } from "@libsql/client";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function verifyPassword(pw, stored) {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(pw, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, Buffer.from(salt, "hex"), 32);
  return `${salt}:${hash.toString("hex")}`;
}

const r = await db.execute({
  sql: "SELECT id, password_hash FROM users WHERE email = ?",
  args: ["klient@example.com"],
});
const row = r.rows[0];
if (!row) {
  console.log("klient not found");
  process.exit(1);
}
const ok = verifyPassword("demo1234", String(row.password_hash));
console.log("demo1234 valid:", ok);
if (!ok) {
  await db.execute({
    sql: "UPDATE users SET password_hash = ? WHERE id = ?",
    args: [hashPassword("demo1234"), Number(row.id)],
  });
  console.log("password RESET to demo1234");
}
