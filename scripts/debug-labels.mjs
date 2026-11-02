// Диагностика: точные лейблы order_lines заказа MS-2026-8941
import { createClient } from "@libsql/client";
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const r = await db.execute("SELECT label FROM order_lines WHERE order_id = (SELECT id FROM orders WHERE ref = 'MS-2026-8941') ORDER BY idx");
for (const row of r.rows) console.log(JSON.stringify(row.label));
