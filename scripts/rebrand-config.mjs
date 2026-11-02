// Обновление company.name в живой Turso (ребрендинг Umzug Service).
import { createClient } from "@libsql/client";
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const r = await db.execute({
  sql: "UPDATE config SET value = ? WHERE key = 'company.name'",
  args: ["Umzug Service GmbH"],
});
console.log("rowsAffected:", r.rowsAffected);
const check = await db.execute({ sql: "SELECT value FROM config WHERE key = 'company.name'", args: [] });
console.log("now:", check.rows[0]?.value);
