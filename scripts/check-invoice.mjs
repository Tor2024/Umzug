import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const inv = await db.execute("SELECT * FROM invoices");
console.log("INVOICES:", JSON.stringify(inv.rows));
const pay = await db.execute("SELECT * FROM payments");
console.log("PAYMENTS:", JSON.stringify(pay.rows));
const o = await db.execute({ sql: "SELECT ref, status FROM orders WHERE ref = ?", args: ["MS-2026-8941"] });
console.log("ORDER:", JSON.stringify(o.rows[0]));
const h = await db.execute({ sql: "SELECT actor_role, action, created_at FROM order_history WHERE order_id = (SELECT id FROM orders WHERE ref = ?) ORDER BY id DESC", args: ["MS-2026-8941"] });
console.log("HISTORY:", h.rows.map(r => `${r.created_at} ${r.actor_role} ${r.action}`).join(" | "));
