// Аудит #8: колонки pending_email* в users (смена email клиентом).
// Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/add-pending-email.mjs
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) { console.error("Need TURSO_DATABASE_URL + TURSO_AUTH_TOKEN"); process.exit(1); }
const db = createClient({ url, authToken: token });

const colsRes = await db.execute("PRAGMA table_info(users)");
const cols = colsRes.rows.map((r) => String(r.name));
const stmts = [];
if (!cols.includes("pending_email")) stmts.push({ sql: "ALTER TABLE users ADD COLUMN pending_email TEXT", args: [] });
if (!cols.includes("pending_email_token")) stmts.push({ sql: "ALTER TABLE users ADD COLUMN pending_email_token TEXT", args: [] });
if (!cols.includes("pending_email_expires")) stmts.push({ sql: "ALTER TABLE users ADD COLUMN pending_email_expires INTEGER", args: [] });
if (stmts.length) await db.batch(stmts, "write");
await db.execute("CREATE INDEX IF NOT EXISTS idx_users_pending_email ON users(pending_email_token)");
console.log("PENDING EMAIL COLS OK:", cols.join(", "));
