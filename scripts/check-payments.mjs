import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const pay = await db.execute("SELECT * FROM payments");
console.log("PAYMENTS:", JSON.stringify(pay.rows));
const inv = await db.execute("SELECT number, status, paid_at FROM invoices");
console.log("INVOICES:", JSON.stringify(inv.rows));
