// Миграция: users.driver_vehicle_id + таблица trip_checkpoints.
// Идемпотентно (PRAGMA table_info). Запуск:
//   $tok = (wsl -e bash -c "~/.turso/turso db tokens create umzug").Trim()
//   $env:TURSO_DATABASE_URL='libsql://umzug-20225246546aq.aws-eu-central-1.turso.io'; $env:TURSO_AUTH_TOKEN=$tok
//   node scripts/add-driver-tracking.mjs
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) { console.error("env TURSO_DATABASE_URL/TURSO_AUTH_TOKEN required"); process.exit(1); }
const db = createClient({ url, authToken: token });

const stmts = [];
const has = async (table, col) => {
  const r = await db.execute({ sql: "PRAGMA table_info(users)", args: [] });
  void table; void col; // params checked below via args
  return r;
};

// users.driver_vehicle_id
const u = await db.execute({ sql: "PRAGMA table_info(users)", args: [] });
const uCols = u.rows.map((r) => r.name);
if (!uCols.includes("driver_vehicle_id")) {
  stmts.push({ sql: "ALTER TABLE users ADD COLUMN driver_vehicle_id INTEGER", args: [] });
  console.log("ADDED users.driver_vehicle_id");
} else console.log("users.driver_vehicle_id exists");

// trip_checkpoints
const t = await db.execute({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='trip_checkpoints'", args: [] });
if (t.rows.length === 0) {
  stmts.push({ sql: `CREATE TABLE IF NOT EXISTS trip_checkpoints (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id    INTEGER NOT NULL REFERENCES orders(id),
    driver_id   INTEGER REFERENCES users(id),
    cp          TEXT NOT NULL CHECK (cp IN ('departed','arrived_load','loaded','arrived_unload','done')),
    lat         REAL,
    lon         REAL,
    created_at  INTEGER NOT NULL
  )`, args: [] });
  stmts.push({ sql: "CREATE INDEX IF NOT EXISTS idx_trip_cp_order ON trip_checkpoints(order_id, created_at)", args: [] });
  console.log("CREATED trip_checkpoints");
} else console.log("trip_checkpoints exists");

if (stmts.length) {
  await db.batch(stmts, "write");
  console.log("BATCH OK", stmts.length, "stmts");
}
console.log("DRIVER TRACKING OK");
