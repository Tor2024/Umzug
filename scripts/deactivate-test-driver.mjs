// Деактивация тестового сотрудника driver-check@example.com
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const r = await db.execute({
  sql: "UPDATE users SET active = 0, email = 'deleted-driver-check@disabled.local' WHERE email = ?",
  args: ["driver-check@example.com"],
});
console.log("deactivated rowsAffected:", Number(r.rowsAffected));

const check = await db.execute({
  sql: "SELECT id, email, active FROM users WHERE id = (SELECT MAX(id) FROM users)",
  args: [],
});
console.log("last user row:", JSON.stringify(check.rows[0]));
