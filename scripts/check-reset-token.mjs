import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const r = await db.execute({
  sql: "SELECT id, email, reset_token IS NOT NULL AS has_token, reset_expires FROM users WHERE email = ?",
  args: ["klient@example.com"],
});
console.log(JSON.stringify(r.rows[0]));
