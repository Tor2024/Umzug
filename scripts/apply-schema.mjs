import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/db.ts", "utf8");
const start = src.indexOf("const SCHEMA_SQL = `");
const end = src.indexOf("`;", start);
const raw = src.slice(start + "const SCHEMA_SQL = `".length, end);
const stmts = raw
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("--"));

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

try {
  await db.batch(
    stmts.map((sql) => ({ sql, args: [] })),
    "write",
  );
  console.log("BATCH OK, statements:", stmts.length);
  const r = await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log("TABLES:", r.rows.map((x) => x.name).join(", "));
} catch (e) {
  console.error("BATCH FAILED:", e.message);
  process.exit(1);
}
