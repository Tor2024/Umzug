import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const u = await db.execute({ sql: "SELECT email, name, active FROM users WHERE email LIKE 'anon-%' OR email LIKE 'gdpr-%'", args: [] });
console.log("ANON/TEST USERS:", JSON.stringify(u.rows));
