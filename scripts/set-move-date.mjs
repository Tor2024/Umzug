import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const [ref, date] = process.argv.slice(2);
if (!ref || !date) {
  console.error("usage: node set-move-date.mjs <ref> <YYYY-MM-DD>");
  process.exit(1);
}

const r = await db.execute({
  sql: "UPDATE orders SET move_date = ? WHERE ref = ?",
  args: [date, ref],
});
console.log("rowsAffected:", r.rowsAffected);
const c = await db.execute({
  sql: "SELECT ref, status, move_date FROM orders WHERE ref = ?",
  args: [ref],
});
console.log(JSON.stringify(c.rows[0]));
