// «Помощник с переездом» — база данных (@libsql/client → Turso в проде, файл локально).
// Схема по PLAN §5/§5a/§10a и решениям D2/D3 (см. PLAN §13).
// Деньги — целые центы. Время — UNIX-секунды (INTEGER UTC), никаких TZ-строк в SQL.
//
// Turso-миграция (после прод-краша better-sqlite3 на Vercel: read-only FS + ephemeral):
// - libsql асинхронный: все запросы await db.execute({sql, args}); rows — named объекты
// - локально без env работает file:data/assistant.db (тот же клиент)
// - транзакции: client.batch([...], "write") — атомарный набор statement'ов

import { createClient, type Client, type InValue } from "@libsql/client";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_TARIFFS, type Tariffs, type VehicleClass } from "./pricing";

/** Тип БД везде в проекте: libsql Client. */
export type DB = Client;

const DB_PATH = process.env.MS_DB_PATH ?? path.join(process.cwd(), "data", "assistant.db");

declare global {
  // eslint-disable-next-line no-var
  var __umzugDb: DB | undefined;
}

/** Singleton-клиент (serverless cold start: один клиент на инстанс). */
export function getDb(): DB {
  if (globalThis.__umzugDb) return globalThis.__umzugDb;
  const url = process.env.TURSO_DATABASE_URL ?? `file:${DB_PATH}`;
  const db = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  globalThis.__umzugDb = db;
  // Схема+seed — лениво при первом обращении; для file:-URL гарантируем каталог
  if (!url.startsWith("libsql://") && !url.startsWith("http")) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  void ensureSchema(db);
  return db;
}

/** Создание схемы + seed; идемпотентно; одна попытка на процесс. */
let schemaReady: Promise<void> | null = null;
export function ensureSchema(db: DB): Promise<void> {
  schemaReady ??= (async () => {
    // libsql HTTP-клиент не принимает несколько стейтментов за один execute —
    // разбиваем SCHEMA_SQL на отдельные CREATE TABLE по точке с запятой.
    const stmts = SCHEMA_SQL.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));
    await db.batch(
      stmts.map((sql) => ({ sql, args: [] })),
      "write",
    );
    await seed(db);
  })();
  return schemaReady;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vehicle_classes (
    class        TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    capacity_m3  REAL NOT NULL,
    included_m3  REAL NOT NULL,
    base_cents   INTEGER NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('kunde','logist','driver','finance','admin')),
    password_hash   TEXT NOT NULL,
    active          INTEGER NOT NULL DEFAULT 1,
    email_verified  INTEGER NOT NULL DEFAULT 0,
    verify_token    TEXT,
    verify_expires  INTEGER,
    reset_token     TEXT,
    reset_expires   INTEGER,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ref            TEXT NOT NULL UNIQUE,
    client_id      INTEGER REFERENCES users(id),
    contact_name   TEXT NOT NULL DEFAULT '',
    contact_email  TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL CHECK (status IN
                     ('new','confirmed','assigned','enroute','acceptance','closed','cancelled')),
    vehicle_class  TEXT NOT NULL REFERENCES vehicle_classes(class),
    snapshot       TEXT NOT NULL,
    volume_m3      REAL NOT NULL,
    distance_km    REAL NOT NULL,
    move_date      TEXT NOT NULL,
    net_cents      INTEGER NOT NULL,
    vat_cents      INTEGER NOT NULL,
    gross_cents    INTEGER NOT NULL,
    deposit_cents  INTEGER NOT NULL,
    remainder_cents INTEGER NOT NULL,
    config_version INTEGER NOT NULL,
    express        INTEGER NOT NULL DEFAULT 0,
    shared_load    INTEGER NOT NULL DEFAULT 0,
    from_text      TEXT NOT NULL DEFAULT '',
    to_text        TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    pending_snapshot TEXT,
    revision_requested_by TEXT,
    current_version INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
  CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(move_date);
  CREATE TABLE IF NOT EXISTS quote_snapshots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id      INTEGER NOT NULL REFERENCES orders(id),
    version       INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    gross_cents   INTEGER NOT NULL,
    at            INTEGER NOT NULL,
    actor_user_id INTEGER REFERENCES users(id),
    UNIQUE(order_id, version)
  );
  CREATE TABLE IF NOT EXISTS order_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id       INTEGER NOT NULL REFERENCES orders(id),
    at             INTEGER NOT NULL,
    actor_user_id  INTEGER REFERENCES users(id),
    actor_role     TEXT NOT NULL,
    action         TEXT NOT NULL,
    client_visible INTEGER NOT NULL DEFAULT 1,
    details        TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_history(order_id);
  CREATE TABLE IF NOT EXISTS order_lines (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    idx      INTEGER NOT NULL,
    kind     TEXT NOT NULL DEFAULT 'line',
    key      TEXT NOT NULL,
    label    TEXT NOT NULL,
    amount   INTEGER NOT NULL,
    meta     TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
  CREATE TABLE IF NOT EXISTS vehicles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plate        TEXT NOT NULL UNIQUE,
    class        TEXT NOT NULL REFERENCES vehicle_classes(class),
    label        TEXT NOT NULL,
    capacity_m3  REAL NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS trips (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id    INTEGER NOT NULL REFERENCES orders(id),
    vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id),
    driver_id   INTEGER NOT NULL REFERENCES users(id),
    codriver_id INTEGER REFERENCES users(id),
    move_date   TEXT NOT NULL,
    seq         INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_trips_order ON trips(order_id);
  CREATE TABLE IF NOT EXISTS assignments (
    resource_type TEXT NOT NULL CHECK (resource_type IN ('driver','vehicle')),
    resource_id   INTEGER NOT NULL,
    move_date     TEXT NOT NULL,
    order_id      INTEGER NOT NULL REFERENCES orders(id),
    PRIMARY KEY (resource_type, resource_id, move_date)
  );
  CREATE TABLE IF NOT EXISTS route (
    order_id   INTEGER PRIMARY KEY REFERENCES orders(id),
    from_text  TEXT NOT NULL,
    to_text    TEXT NOT NULL,
    km         REAL NOT NULL,
    minutes    INTEGER NOT NULL,
    provider   TEXT NOT NULL CHECK (provider IN ('google','osrm','fallback')),
    geometry   TEXT,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS protocol (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER NOT NULL UNIQUE REFERENCES orders(id),
    loaded_json  TEXT NOT NULL,
    deviation_m3 REAL NOT NULL,
    notes        TEXT NOT NULL DEFAULT '',
    signature    TEXT NOT NULL,
    prev_hash    TEXT NOT NULL,
    hash         TEXT NOT NULL,
    signed_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invoices (
    number        TEXT PRIMARY KEY,
    order_id      INTEGER NOT NULL UNIQUE REFERENCES orders(id),
    amount_cents  INTEGER NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('open','paid','overdue','in_review','cancelled')),
    dunning_level INTEGER NOT NULL DEFAULT 0,
    due_date      TEXT NOT NULL,
    paid_at       INTEGER
  );
  CREATE TABLE IF NOT EXISTS payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER NOT NULL REFERENCES orders(id),
    invoice_id   INTEGER REFERENCES invoices(number),
    amount_cents INTEGER NOT NULL,
    method       TEXT NOT NULL CHECK (method IN ('sepa','card','cash','paypal','klarna')),
    paid_at      INTEGER NOT NULL,
    note         TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
  CREATE TABLE IF NOT EXISTS claims (
    number      TEXT PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders(id),
    item        TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('new','in_review','offer','resolved','rejected')),
    resolution  TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        INTEGER NOT NULL,
    user_id   INTEGER,
    action    TEXT NOT NULL,
    entity    TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    details   TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS counters (
    prefix TEXT NOT NULL,
    year   INTEGER NOT NULL,
    last   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (prefix, year)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES orders(id),
    from_role  TEXT NOT NULL CHECK (from_role IN ('kunde','logist','driver','finance','admin')),
    from_user_id INTEGER,
    from_email TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL,
    read_at    INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id, created_at);
`;

// ---------------------------------------------------------------------------
// Пароли (D3): scrypt, per-user случайная соль, формат 'salt:hash'
// ---------------------------------------------------------------------------

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(pw, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

const newToken = (): string => randomBytes(32).toString("hex");

// ---------------------------------------------------------------------------
// Аудит
// ---------------------------------------------------------------------------

export async function audit(
  db: DB,
  userId: number | null,
  action: string,
  entity: string,
  entityId: string | number = "",
  details = "",
): Promise<void> {
  await db.execute({
    sql: "INSERT INTO audit (at, user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)",
    args: [Math.floor(Date.now() / 1000), userId, action, entity, String(entityId), details],
  });
}

// ---------------------------------------------------------------------------
// Тарифы из БД: config (namespace pricing.*) + vehicle_classes → Tariffs
// ---------------------------------------------------------------------------

/** Реестр конфига (D2): тип/мин/макс; setConfig() — единственный путь записи. */
export const CONFIG_SCHEMA: Record<string, { type: "int" | "pct" | "cents" | "bool" | "string"; min: number; max: number }> = {
  "pricing.crew_hourly_cents": { type: "cents", min: 0, max: 20_000 },
  "pricing.crew_count": { type: "int", min: 1, max: 8 },
  "pricing.hours_per_m3": { type: "int", min: 5, max: 100 },
  "pricing.min_crew_hours": { type: "int", min: 0, max: 8 },
  "pricing.per_km_cents": { type: "cents", min: 0, max: 1_000 },
  "pricing.free_km": { type: "int", min: 0, max: 200 },
  "pricing.avg_speed_kmh": { type: "int", min: 30, max: 120 },
  "pricing.floor_cents": { type: "cents", min: 0, max: 10_000 },
  "pricing.elevator_cents": { type: "cents", min: 0, max: 20_000 },
  "pricing.extra_m3_cents": { type: "cents", min: 0, max: 5_000 },
  "pricing.box_cents": { type: "cents", min: 0, max: 2_000 },
  "pricing.pack_hourly_cents": { type: "cents", min: 0, max: 20_000 },
  "pricing.kitchen_cents": { type: "cents", min: 0, max: 100_000 },
  "pricing.furniture_cents": { type: "cents", min: 0, max: 20_000 },
  "pricing.hvz_zone_cents": { type: "cents", min: 0, max: 50_000 },
  "pricing.vat_pct": { type: "pct", min: 0, max: 25 },
  "pricing.vat_enabled": { type: "bool", min: 0, max: 1 },
  "pricing.deposit_pct": { type: "pct", min: 0, max: 100 },
  "pricing.weekend_pct": { type: "pct", min: 0, max: 50 },
  "pricing.express_pct": { type: "pct", min: 0, max: 100 },
  "pricing.shared_load_pct": { type: "pct", min: 0, max: 50 },
  "pricing.season_pct": { type: "pct", min: -50, max: 50 },
  "pricing.load_pct": { type: "pct", min: -50, max: 100 },
  "pricing.auto_load_pct": { type: "pct", min: 0, max: 50 },
  "pricing.quote_valid_days": { type: "int", min: 1, max: 60 },
  "finance.due_days": { type: "int", min: 1, max: 60 },
  "maps.api_key": { type: "string", min: 0, max: 200 },
};

const TARIFF_KEYS: Record<string, keyof Tariffs> = {
  "pricing.crew_hourly_cents": "crewHourlyCents",
  "pricing.crew_count": "crewCount",
  "pricing.hours_per_m3": "hoursPerM3",
  "pricing.min_crew_hours": "minCrewHours",
  "pricing.per_km_cents": "perKmCents",
  "pricing.free_km": "freeKm",
  "pricing.avg_speed_kmh": "avgSpeedKmh",
  "pricing.floor_cents": "floorCents",
  "pricing.elevator_cents": "elevatorCents",
  "pricing.extra_m3_cents": "extraM3Cents",
  "pricing.box_cents": "boxCents",
  "pricing.pack_hourly_cents": "packHourlyCents",
  "pricing.kitchen_cents": "kitchenCents",
  "pricing.furniture_cents": "furnitureCents",
  "pricing.hvz_zone_cents": "hvzZoneCents",
  "pricing.vat_pct": "vatPct",
  "pricing.vat_enabled": "vatEnabled",
  "pricing.deposit_pct": "depositPct",
  "pricing.weekend_pct": "weekendPct",
  "pricing.express_pct": "expressPct",
  "pricing.shared_load_pct": "sharedLoadPct",
  "pricing.season_pct": "seasonPct",
  "pricing.load_pct": "loadPct",
  "pricing.auto_load_pct": "autoLoadPct",
  "pricing.quote_valid_days": "quoteValidDays",
};

/** Читает config + vehicle_classes → Tariffs (над DEFAULT_TARIFFS). */
export async function getTariffs(db: DB): Promise<Tariffs> {
  await ensureSchema(db);
  const t: Tariffs = structuredClone(DEFAULT_TARIFFS);
  const res = await db.execute("SELECT key, value FROM config WHERE key LIKE 'pricing.%'");
  for (const row of res.rows) {
    const key = String(row.key);
    const value = String(row.value);
    const field = TARIFF_KEYS[key];
    const s = CONFIG_SCHEMA[key];
    if (!field || !s) continue;
    if (s.type === "bool") {
      (t[field] as boolean) = value === "1" || value === "true";
    } else {
      const n = Number(value.replace(",", "."));
      if (!Number.isFinite(n)) continue;
      const v = Math.min(s.max, Math.max(s.min, n));
      (t[field] as number) = key === "pricing.hours_per_m3" ? v / 100 : v;
    }
  }
  const cls = await db.execute("SELECT class, label, capacity_m3, included_m3, base_cents FROM vehicle_classes WHERE active = 1");
  for (const c of cls.rows) {
    const cl = String(c.class);
    if (cl === "A" || cl === "B" || cl === "C") {
      t.classes[cl] = { label: String(c.label), capacityM3: Number(c.capacity_m3), includedM3: Number(c.included_m3), baseCents: Number(c.base_cents) };
    }
  }
  return t;
}

/**
 * Валидация значения конфига без записи (D8.1). Синхронная — чистый парсинг.
 */
export function normalizeConfigValue(key: string, raw: string): string {
  const s = CONFIG_SCHEMA[key];
  if (!s) throw new Error(`Неизвестный ключ конфига: ${key}`);
  if (s.type === "bool") {
    return raw === "1" || raw === "true" ? "1" : "0";
  }
  if (s.type === "string") {
    return raw.trim().slice(0, s.max);
  }
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`Значение ${key} не число`);
  return String(Math.min(s.max, Math.max(s.min, n)));
}

/** Запись уже нормализованного значения. */
export async function writeConfigValue(db: DB, key: string, value: string): Promise<void> {
  await db.execute({
    sql: "INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    args: [key, value, Math.floor(Date.now() / 1000)],
  });
}

/** Единственный путь записи конфига (D2). */
export async function setConfig(db: DB, key: string, raw: string): Promise<void> {
  await writeConfigValue(db, key, normalizeConfigValue(key, raw));
}

/** Автовыбор класса по объёму (§3). */
export async function classForVolume(db: DB, volumeM3: number): Promise<VehicleClass> {
  await ensureSchema(db);
  const res = await db.execute("SELECT class, capacity_m3 FROM vehicle_classes WHERE active = 1 ORDER BY capacity_m3");
  for (const row of res.rows) {
    const cl = String(row.class);
    if (cl === "A" || cl === "B" || cl === "C") {
      if (volumeM3 <= Number(row.capacity_m3)) return cl;
    }
  }
  return "C";
}

// ---------------------------------------------------------------------------
// Демо-данные (идемпотентно)
// ---------------------------------------------------------------------------

const DEMO_PASSWORD = "demo1234";

async function seed(db: DB): Promise<void> {
  let r = await db.execute("SELECT COUNT(*) AS n FROM users");
  if (Number((r.rows[0] as unknown as { n: number }).n) === 0) {
    const now = Math.floor(Date.now() / 1000);
    const hash = hashPassword(DEMO_PASSWORD);
    const users = [
      ["klient@example.com", "Анна Сафрова", "kunde"],
      ["logist@example.com", "Сергей Волков", "logist"],
      ["voditel@example.com", "Мурат Джан", "driver"],
      ["voditel2@example.com", "Окан Еылмаз", "driver"],
      ["buh@example.com", "Петра Андерс", "finance"],
      ["admin@example.com", "Маркус Фогель", "admin"],
    ] as const;
    for (const [email, name, role] of users) {
      await db.execute({
        sql: "INSERT INTO users (email, name, role, password_hash, active, email_verified, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)",
        args: [email, name, role, hash, now],
      });
    }
  }

  r = await db.execute("SELECT COUNT(*) AS n FROM vehicle_classes");
  if (Number((r.rows[0] as unknown as { n: number }).n) === 0) {
    const classes = [
      ["A", "Transporter 3,5 т", 15, 10, DEFAULT_TARIFFS.classes.A.baseCents],
      ["B", "LKW 7,5 т", 35, 20, DEFAULT_TARIFFS.classes.B.baseCents],
      ["C", "LKW 12 т", 55, 40, DEFAULT_TARIFFS.classes.C.baseCents],
    ] as const;
    for (const [cl, label, cap, incl, base] of classes) {
      await db.execute({
        sql: "INSERT INTO vehicle_classes (class, label, capacity_m3, included_m3, base_cents) VALUES (?, ?, ?, ?, ?)",
        args: [cl, label, cap, incl, base],
      });
    }
  }

  r = await db.execute("SELECT COUNT(*) AS n FROM vehicles");
  if (Number((r.rows[0] as unknown as { n: number }).n) === 0) {
    const vehicles = [
      ["B-MA 1001", "A", "Transporter 3,5 т", 15],
      ["B-MA 2002", "B", "LKW 7,5 т", 35],
      ["B-MA 3003", "B", "LKW 7,5 т", 35],
      ["B-MA 4004", "C", "LKW 12 т", 55],
    ] as const;
    for (const [plate, cl, label, cap] of vehicles) {
      await db.execute({
        sql: "INSERT INTO vehicles (plate, class, label, capacity_m3, active) VALUES (?, ?, ?, ?, 1)",
        args: [plate, cl, label, cap],
      });
    }
  }

  const defaults: Record<string, string> = {
    "pricing.crew_hourly_cents": String(DEFAULT_TARIFFS.crewHourlyCents),
    "pricing.crew_count": String(DEFAULT_TARIFFS.crewCount),
    "pricing.hours_per_m3": String(Math.round(DEFAULT_TARIFFS.hoursPerM3 * 100)),
    "pricing.min_crew_hours": String(DEFAULT_TARIFFS.minCrewHours),
    "pricing.per_km_cents": String(DEFAULT_TARIFFS.perKmCents),
    "pricing.free_km": String(DEFAULT_TARIFFS.freeKm),
    "pricing.avg_speed_kmh": String(DEFAULT_TARIFFS.avgSpeedKmh),
    "pricing.floor_cents": String(DEFAULT_TARIFFS.floorCents),
    "pricing.elevator_cents": String(DEFAULT_TARIFFS.elevatorCents),
    "pricing.extra_m3_cents": String(DEFAULT_TARIFFS.extraM3Cents),
    "pricing.box_cents": String(DEFAULT_TARIFFS.boxCents),
    "pricing.pack_hourly_cents": String(DEFAULT_TARIFFS.packHourlyCents),
    "pricing.kitchen_cents": String(DEFAULT_TARIFFS.kitchenCents),
    "pricing.furniture_cents": String(DEFAULT_TARIFFS.furnitureCents),
    "pricing.hvz_zone_cents": String(DEFAULT_TARIFFS.hvzZoneCents),
    "pricing.vat_pct": String(DEFAULT_TARIFFS.vatPct),
    "pricing.vat_enabled": DEFAULT_TARIFFS.vatEnabled ? "1" : "0",
    "pricing.deposit_pct": String(DEFAULT_TARIFFS.depositPct),
    "pricing.weekend_pct": String(DEFAULT_TARIFFS.weekendPct),
    "pricing.express_pct": String(DEFAULT_TARIFFS.expressPct),
    "pricing.shared_load_pct": String(DEFAULT_TARIFFS.sharedLoadPct),
    "pricing.season_pct": String(DEFAULT_TARIFFS.seasonPct),
    "pricing.load_pct": String(DEFAULT_TARIFFS.loadPct),
    "pricing.auto_load_pct": String(DEFAULT_TARIFFS.autoLoadPct),
    "pricing.quote_valid_days": String(DEFAULT_TARIFFS.quoteValidDays),
    "finance.due_days": "14",
    "company.name": "Помощник с переездом GmbH",
    "maps.api_key": "",
  };
  const now = Math.floor(Date.now() / 1000);
  for (const [k, v] of Object.entries(defaults)) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO config (key, value, updated_at) VALUES (?, ?, ?)",
      args: [k, v, now],
    });
  }
}

// ---------------------------------------------------------------------------
// Сессии (D3-финал): токен 32 байта, в БД только sha256, TTL 12ч
// ---------------------------------------------------------------------------

export const SESSION_TTL_S = 12 * 3600;

export async function createSession(db: DB, userId: number): Promise<{ token: string; expiresAt: number }> {
  await db.execute({ sql: "DELETE FROM sessions WHERE expires_at < ?", args: [Math.floor(Date.now() / 1000)] });
  const token = newToken();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  await db.execute({
    sql: "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    args: [sha256(token), userId, expiresAt, Math.floor(Date.now() / 1000)],
  });
  return { token, expiresAt };
}

/** Атомарная ротация (D3): UPDATE по тому же токену. */
export async function rotateSession(db: DB, oldToken: string): Promise<{ token: string; expiresAt: number }> {
  const token = newToken();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  await db.execute({
    sql: "UPDATE sessions SET token_hash = ?, expires_at = ?, created_at = ? WHERE token_hash = ?",
    args: [sha256(token), expiresAt, Math.floor(Date.now() / 1000), sha256(oldToken)],
  });
  return { token, expiresAt };
}

export async function deleteSession(db: DB, token: string): Promise<void> {
  await db.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [sha256(token)] });
}

/** Инвалидация всех сессий пользователя — только при смене пароля (D3). */
export async function invalidateUserSessions(db: DB, userId: number): Promise<void> {
  await db.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] });
}

// ---------------------------------------------------------------------------
// Протокол (Э5/D6): глобальная sha256-цепочка от GENESIS, INSERT-only
// ---------------------------------------------------------------------------

export interface ProtocolRow {
  id: number;
  order_id: number;
  loaded_json: string;
  deviation_m3: number;
  notes: string;
  signature: string;
  prev_hash: string;
  hash: string;
  signed_at: number;
}

/** Детерминированная хеш-строка протокола (D6.2). */
export function protocolHashString(p: {
  orderId: number; loadedJson: string; deviation: number;
  notes: string; signature: string; prevHash: string; signedAt: number;
}): string {
  return [
    p.orderId, p.loadedJson, p.deviation,
    p.notes, p.signature, p.prevHash, p.signedAt,
  ].join("|");
}

/** D6.11: пересчёт всей цепочки. */
export async function verifyChain(db: DB): Promise<{ valid: boolean; brokenAt?: number; count: number }> {
  await ensureSchema(db);
  const res = await db.execute("SELECT * FROM protocol ORDER BY id ASC");
  const rows = res.rows as unknown as ProtocolRow[];
  let prev = "GENESIS";
  for (const r of rows) {
    const expect = sha256(protocolHashString({
      orderId: Number(r.order_id),
      loadedJson: String(r.loaded_json),
      deviation: Number(r.deviation_m3),
      notes: String(r.notes),
      signature: String(r.signature),
      prevHash: String(r.prev_hash),
      signedAt: Number(r.signed_at),
    }));
    if (String(r.prev_hash) !== prev || String(r.hash) !== expect) {
      return { valid: false, brokenAt: Number(r.id), count: rows.length };
    }
    prev = String(r.hash);
  }
  return { valid: true, count: rows.length };
}

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: "kunde" | "logist" | "driver" | "finance" | "admin";
}

// ---------------------------------------------------------------------------
// D10: история заказа + версии снимков цены
// ---------------------------------------------------------------------------

export interface HistoryRow {
  id: number;
  order_id: number;
  at: number;
  actor_user_id: number | null;
  actor_role: string;
  action: string;
  client_visible: number;
  details: string;
}

/** Бизнес-событие заказа: order_history (клиент) + audit (compliance). */
export async function logOrderEvent(
  db: DB,
  orderId: number,
  actor: SessionUser,
  action: string,
  details: Record<string, unknown>,
  opts?: { clientVisible?: boolean },
): Promise<void> {
  const json = JSON.stringify(details);
  await db.execute({
    sql: "INSERT INTO order_history (order_id, at, actor_user_id, actor_role, action, client_visible, details) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [orderId, Math.floor(Date.now() / 1000), actor.id, actor.role, action, opts?.clientVisible === false ? 0 : 1, json],
  });
  await audit(db, actor.id, action, "order", String(orderId), json.slice(0, 200));
}

/** Сохранить снимок как новую версию (append-only); вернуть номер версии. */
export async function saveSnapshotVersion(db: DB, orderId: number, snapshotJson: string, grossCents: number, actorUserId: number | null): Promise<number> {
  const cur = await db.execute({ sql: "SELECT COALESCE(MAX(version),0) AS v FROM quote_snapshots WHERE order_id = ?", args: [orderId] });
  const version = Number((cur.rows[0] as unknown as { v: number }).v) + 1;
  await db.execute({
    sql: "INSERT INTO quote_snapshots (order_id, version, snapshot_json, gross_cents, at, actor_user_id) VALUES (?, ?, ?, ?, ?, ?)",
    args: [orderId, version, snapshotJson, grossCents, Math.floor(Date.now() / 1000), actorUserId],
  });
  await db.execute({ sql: "UPDATE orders SET current_version = ? WHERE id = ?", args: [version, orderId] });
  return version;
}

export interface SnapshotVersionRow {
  version: number;
  gross_cents: number;
  at: number;
}

/** История цен заказа. */
export async function snapshotVersions(db: DB, orderId: number): Promise<SnapshotVersionRow[]> {
  await ensureSchema(db);
  const res = await db.execute({
    sql: "SELECT version, gross_cents, at FROM quote_snapshots WHERE order_id = ? ORDER BY version DESC",
    args: [orderId],
  });
  return res.rows.map((r) => ({
    version: Number(r.version),
    gross_cents: Number(r.gross_cents),
    at: Number(r.at),
  }));
}

/** История заказа: клиент видит только client_visible=1. */
export async function orderHistory(db: DB, orderId: number, includeHidden = false): Promise<HistoryRow[]> {
  await ensureSchema(db);
  const res = await db.execute({
    sql: `SELECT * FROM order_history WHERE order_id = ? ${includeHidden ? "" : "AND client_visible = 1"} ORDER BY id DESC LIMIT 100`,
    args: [orderId],
  });
  return res.rows as unknown as HistoryRow[];
}

export interface AllHistoryRow extends HistoryRow {
  ref: string;
}

/** Полная история всех заказов (админ). */
export async function listAllOrderHistory(db: DB, limit = 100): Promise<AllHistoryRow[]> {
  await ensureSchema(db);
  const res = await db.execute({
    sql: "SELECT h.*, o.ref FROM order_history h JOIN orders o ON o.id = h.order_id ORDER BY h.id DESC LIMIT ?",
    args: [limit],
  });
  return res.rows as unknown as AllHistoryRow[];
}

/** Поиск сессии по сырому токену. Активность проверяется на каждый запрос (D3). */
export async function findSession(db: DB, token: string): Promise<SessionUser | null> {
  if (!token) return null;
  await ensureSchema(db);
  const res = await db.execute({
    sql: `SELECT u.id, u.email, u.name, u.role, u.active, s.expires_at
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?`,
    args: [sha256(token)],
  });
  const row = res.rows[0] as unknown as { id: number; email: string; name: string; role: SessionUser["role"]; active: number; expires_at: number } | undefined;
  if (!row) return null;
  if (Number(row.expires_at) < Math.floor(Date.now() / 1000)) return null;
  if (!Number(row.active)) return null;
  return { id: Number(row.id), email: String(row.email), name: String(row.name), role: row.role };
}

export type { InValue };
