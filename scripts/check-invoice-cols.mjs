import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const cols = await db.execute("PRAGMA table_info(invoices)");
console.log("INVOICE COLS:", cols.rows.map(r => r.name).join(", "));
