// Миграция: локации машин + субподрядчики (требование @1480@).
// Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/add-vehicle-locations.mjs
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) { console.error("Need TURSO_DATABASE_URL + TURSO_AUTH_TOKEN"); process.exit(1); }

const db = createClient({ url, authToken: token });

// 1. vehicles: home_base + current_location
const vehCols = await db.execute("PRAGMA table_info(vehicles)");
const vehNames = vehCols.rows.map((r) => String(r.name));
const vehStmts = [];
if (!vehNames.includes("home_base")) vehStmts.push({ sql: "ALTER TABLE vehicles ADD COLUMN home_base TEXT NOT NULL DEFAULT ''", args: [] });
if (!vehNames.includes("current_location")) vehStmts.push({ sql: "ALTER TABLE vehicles ADD COLUMN current_location TEXT NOT NULL DEFAULT ''", args: [] });
if (vehStmts.length) { await db.batch(vehStmts, "write"); console.log("ADDED vehicle cols:", vehStmts.map((s) => s.sql.match(/ADD COLUMN (\w+)/)?.[1]).join(", ")); }
else console.log("vehicle cols already present");

// 2. таблица subcontractors (если ещё нет)
await db.batch([
  { sql: `CREATE TABLE IF NOT EXISTS subcontractors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    contact     TEXT NOT NULL DEFAULT '',
    phone       TEXT NOT NULL DEFAULT '',
    email       TEXT NOT NULL DEFAULT '',
    class       TEXT NOT NULL REFERENCES vehicle_classes(class),
    price_mode  TEXT NOT NULL CHECK (price_mode IN ('per_km','per_order','per_day')),
    price_cents INTEGER NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 1
  )`, args: [] },
  { sql: `CREATE TABLE IF NOT EXISTS order_subcontractors (
    order_id     INTEGER PRIMARY KEY REFERENCES orders(id),
    sub_id       INTEGER NOT NULL REFERENCES subcontractors(id),
    cost_cents   INTEGER NOT NULL,
    move_date    TEXT NOT NULL
  )`, args: [] },
], "write");
console.log("SUBCONTRACTORS TABLES OK");

// 3. текущая локация = адрес выгрузки последнего закрытого рейса (реалистичная инициализация)
const upd = await db.execute(`
  UPDATE vehicles SET
    home_base = COALESCE(NULLIF(home_base, ''), 'Musterstraße 12, 10115 Berlin'),
    current_location = COALESCE(NULLIF(current_location, ''), 'Musterstraße 12, 10115 Berlin')
`);
console.log("initialized locations, rowsAffected:", Number(upd.rowsAffected));

const check = await db.execute("SELECT plate, home_base, current_location FROM vehicles");
for (const r of check.rows) console.log(" ", r.plate, "|", r.home_base, "|", r.current_location);
