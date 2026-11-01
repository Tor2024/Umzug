// «Помощник с переездом» — база данных (better-sqlite3).
// Схема по PLAN §5/§5a/§10a и решениям D2/D3 (см. PLAN §13).
// Деньги — целые центы. Время — UNIX-секунды (INTEGER UTC), никаких TZ-строк в SQL.

import Database from "better-sqlite3";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_TARIFFS, type Tariffs, type VehicleClass } from "./pricing";

const DB_PATH = process.env.MS_DB_PATH ?? path.join(process.cwd(), "data", "assistant.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initDb(db);
  _db = db;
  return db;
}

export function initDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vehicle_classes (
      class        TEXT PRIMARY KEY,            -- 'A' | 'B' | 'C'
      label        TEXT NOT NULL,
      capacity_m3  REAL NOT NULL,
      included_m3  REAL NOT NULL,
      base_cents   INTEGER NOT NULL,
      active       INTEGER NOT NULL DEFAULT 1   -- D2: удаление класса запрещено, только деактивация
    );

    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      email           TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- D3: регистронезависимый email
      name            TEXT NOT NULL,
      role            TEXT NOT NULL CHECK (role IN ('kunde','logist','driver','finance','admin')),
      password_hash   TEXT NOT NULL,          -- 'salt:hash' hex, per-user случайная соль (D3)
      active          INTEGER NOT NULL DEFAULT 1,
      email_verified  INTEGER NOT NULL DEFAULT 0,
      verify_token    TEXT,
      verify_expires  INTEGER,                -- UNIX сек
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash  TEXT PRIMARY KEY,           -- sha256(token) — сырой токен в БД не храним (D2)
      user_id     INTEGER NOT NULL REFERENCES users(id),
      expires_at  INTEGER NOT NULL,           -- UNIX сек; TTL 12ч от логина, без скользящего продления (D3)
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS orders (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      ref            TEXT NOT NULL UNIQUE,    -- MS-ГГГГ-NNNN
      client_id      INTEGER REFERENCES users(id),  -- NULL = заявка без привязки (зарезервировано; D4.5: сабмит только для kunde)
      -- контакты (D4.5): для kunde дублируются из users для списков; guest-полей нет
      contact_name   TEXT NOT NULL DEFAULT '',
      contact_email  TEXT NOT NULL DEFAULT '',
      status         TEXT NOT NULL CHECK (status IN
                       ('new','confirmed','assigned','enroute','acceptance','closed','cancelled')),
      vehicle_class  TEXT NOT NULL REFERENCES vehicle_classes(class),
      snapshot       TEXT NOT NULL,           -- JSON QuoteSnapshot (config+tariffs+quoteValidUntil)
      -- денормализованное из расчёта — для списков без парсинга снимка
      volume_m3      REAL NOT NULL,
      distance_km    REAL NOT NULL,
      move_date      TEXT NOT NULL,           -- ISO yyyy-mm-dd
      net_cents      INTEGER NOT NULL,
      vat_cents      INTEGER NOT NULL,
      gross_cents    INTEGER NOT NULL,
      deposit_cents  INTEGER NOT NULL,
      remainder_cents INTEGER NOT NULL,
      config_version INTEGER NOT NULL,
      express        INTEGER NOT NULL DEFAULT 0,
      shared_load    INTEGER NOT NULL DEFAULT 0,
      from_text      TEXT NOT NULL DEFAULT '',    -- адрес откуда (денорм. для списков; истина — route)
      to_text        TEXT NOT NULL DEFAULT '',
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      -- D10: двусторонняя корректировка (правки только в new/confirmed; дедлайны 72/48 ч, express 24)
      pending_snapshot TEXT,                     -- JSON QuoteSnapshot предложенной правки (NULL = нет активной ревизии)
      revision_requested_by TEXT,                -- 'kunde' | 'logist' | NULL
      current_version INTEGER NOT NULL DEFAULT 1 -- версия текущего снимка (история в quote_snapshots)
    );
    CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
    CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(move_date);

    -- D10: история цены — append-only версии снимков (старые не удаляются)
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

    -- D10: история заказа — бизнес-события для клиента (audit — служебный, клиенту не показывается)
    CREATE TABLE IF NOT EXISTS order_history (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id       INTEGER NOT NULL REFERENCES orders(id),
      at             INTEGER NOT NULL,
      actor_user_id  INTEGER REFERENCES users(id),
      actor_role     TEXT NOT NULL,
      action         TEXT NOT NULL,  -- revision_proposed|revision_accepted|revision_rejected|status_changed|cancelled|order_created
      client_visible INTEGER NOT NULL DEFAULT 1,
      details        TEXT NOT NULL DEFAULT '{}'  -- JSON {fields:{volume:{from,to}}, from_gross, to_gross, snapshot_versions:[1,2]}
    );
    CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_history(order_id);

    CREATE TABLE IF NOT EXISTS order_lines (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      idx      INTEGER NOT NULL,
      kind     TEXT NOT NULL DEFAULT 'line',  -- line | adjustment | total (D4.9/D6.4)
      key      TEXT NOT NULL,
      label    TEXT NOT NULL,
      amount   INTEGER NOT NULL,
      meta     TEXT NOT NULL DEFAULT '{}'     -- JSON
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
      seq         INTEGER NOT NULL DEFAULT 1   -- D2: без UNIQUE, несколько рейсов на дату
    );
    CREATE INDEX IF NOT EXISTS idx_trips_order ON trips(order_id);

    -- D2: уникальность занятости ресурса на дату (водитель или машина)
    CREATE TABLE IF NOT EXISTS assignments (
      resource_type TEXT NOT NULL CHECK (resource_type IN ('driver','vehicle')),
      resource_id   INTEGER NOT NULL,
      move_date     TEXT NOT NULL,
      order_id      INTEGER NOT NULL REFERENCES orders(id),
      PRIMARY KEY (resource_type, resource_id, move_date)
    );

    -- Маршрут вынесен из orders (D2): переполучение не переписывает заказ
    CREATE TABLE IF NOT EXISTS route (
      order_id   INTEGER PRIMARY KEY REFERENCES orders(id),
      from_text  TEXT NOT NULL,
      to_text    TEXT NOT NULL,
      km         REAL NOT NULL,
      minutes    INTEGER NOT NULL,
      provider   TEXT NOT NULL CHECK (provider IN ('google','osrm','fallback')),
      geometry   TEXT,              -- JSON [lat,lon][] polyline для карты (Leaflet, Э8+)
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS protocol (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id     INTEGER NOT NULL UNIQUE REFERENCES orders(id),
      loaded_json  TEXT NOT NULL,             -- JSON план/факт
      deviation_m3 REAL NOT NULL,
      notes        TEXT NOT NULL DEFAULT '',
      signature    TEXT NOT NULL,
      prev_hash    TEXT NOT NULL,
      hash         TEXT NOT NULL,             -- sha256-цепочка (§6)
      signed_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      number        TEXT PRIMARY KEY,          -- RE-ГГГГ-0NNN (GoBD, §6)
      order_id      INTEGER NOT NULL UNIQUE REFERENCES orders(id),
      amount_cents  INTEGER NOT NULL,
      status        TEXT NOT NULL CHECK (status IN ('open','paid','overdue','in_review','cancelled')),
      dunning_level INTEGER NOT NULL DEFAULT 0,
      due_date      TEXT NOT NULL,
      paid_at       INTEGER
    );

    -- D2: платежи — единственный источник денежной правды
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
      number      TEXT PRIMARY KEY,            -- SC-ГГГГ-NNNN
      order_id    INTEGER NOT NULL REFERENCES orders(id),
      item        TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      status      TEXT NOT NULL CHECK (status IN ('new','in_review','offer','resolved','rejected')),
      resolution  TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL
    );

    -- D3/D2: аудит — user_id, без PII-значений
    CREATE TABLE IF NOT EXISTS audit (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      at        INTEGER NOT NULL,
      user_id   INTEGER,
      action    TEXT NOT NULL,
      entity    TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      details   TEXT NOT NULL DEFAULT ''
    );

    -- D2: счётчики обобщены (префикс + год)
    CREATE TABLE IF NOT EXISTS counters (
      prefix TEXT NOT NULL,
      year   INTEGER NOT NULL,
      last   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (prefix, year)
    );
  `);
  seed(db);
}

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

export function audit(
  db: Database.Database,
  userId: number | null,
  action: string,
  entity: string,
  entityId: string | number = "",
  details = "",
): void {
  db.prepare(
    "INSERT INTO audit (at, user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(Math.floor(Date.now() / 1000), userId, action, entity, String(entityId), details);
}

// ---------------------------------------------------------------------------
// Тарифы из БД: config (namespace pricing.*) + vehicle_classes → Tariffs
// ---------------------------------------------------------------------------

/** Реестр конфига (D2): тип/мин/макс; setConfig() — единственный путь записи. */
export const CONFIG_SCHEMA: Record<string, { type: "int" | "pct" | "cents" | "bool" | "string"; min: number; max: number }> = {
  "pricing.crew_hourly_cents": { type: "cents", min: 0, max: 20_000 },
  "pricing.crew_count": { type: "int", min: 1, max: 8 },
  "pricing.hours_per_m3": { type: "int", min: 5, max: 100 },        // ×100 (0.05–1.0 ч/м³)
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
  "pricing.shared_load_pct": { type: "pct", min: 0, max: 50 },      // скидка, применяется как −
  "pricing.season_pct": { type: "pct", min: -50, max: 50 },
  "pricing.load_pct": { type: "pct", min: -50, max: 100 },
  "pricing.quote_valid_days": { type: "int", min: 1, max: 60 },
  "finance.due_days": { type: "int", min: 1, max: 60 },             // D7.9: срок оплаты счёта
  "maps.api_key": { type: "string", min: 0, max: 200 },             // D8.5: строковый ключ; маскируется в UI
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
  "pricing.quote_valid_days": "quoteValidDays",
};/** Читает config + vehicle_classes → Tariffs (над DEFAULT_TARIFFS). */
export function getTariffs(db: Database.Database): Tariffs {
  const t: Tariffs = structuredClone(DEFAULT_TARIFFS);
  const rows = db.prepare("SELECT key, value FROM config WHERE key LIKE 'pricing.%'").all() as { key: string; value: string }[];
  const schema = CONFIG_SCHEMA;
  for (const { key, value } of rows) {
    const field = TARIFF_KEYS[key];
    const s = schema[key];
    if (!field || !s) continue;
    if (s.type === "bool") {
      (t[field] as boolean) = value === "1" || value === "true";
    } else {
      const n = Number(value.replace(",", "."));
      if (!Number.isFinite(n)) continue;
      const v = Math.min(s.max, Math.max(s.min, n));
      // hours_per_m3 хранится ×100 (int) → обратно в часы
      (t[field] as number) = key === "pricing.hours_per_m3" ? v / 100 : v;
    }
  }
  const classes = db.prepare("SELECT class, label, capacity_m3, included_m3, base_cents FROM vehicle_classes WHERE active = 1").all() as
    { class: string; label: string; capacity_m3: number; included_m3: number; base_cents: number }[];
  for (const c of classes) {
    if (c.class === "A" || c.class === "B" || c.class === "C") {
      t.classes[c.class] = { label: c.label, capacityM3: c.capacity_m3, includedM3: c.included_m3, baseCents: c.base_cents };
    }
  }
  return t;
}

/**
 * Валидация значения конфига без записи (D8.1: validate-all-then-write для батча).
 * Возвращает нормализованное строковое значение; бросает Error при NaN/неизвестном ключе.
 */
export function normalizeConfigValue(key: string, raw: string): string {
  const s = CONFIG_SCHEMA[key];
  if (!s) throw new Error(`Неизвестный ключ конфига: ${key}`);
  if (s.type === "bool") {
    return raw === "1" || raw === "true" ? "1" : "0";
  }
  if (s.type === "string") {
    return raw.trim().slice(0, s.max); // D8.5: строковый ключ (maps.api_key)
  }
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`Значение ${key} не число`);
  return String(Math.min(s.max, Math.max(s.min, n)));
}

/** Запись уже нормализованного значения (внутри транзакции вызывающего). */
export function writeConfigValue(db: Database.Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, Math.floor(Date.now() / 1000));
}

/**
 * Единственный путь записи конфига (D2): валидация по CONFIG_SCHEMA,
 * clamp в [min,max], NaN → ошибка, запятая → точка.
 */
export function setConfig(db: Database.Database, key: string, raw: string): void {
  writeConfigValue(db, key, normalizeConfigValue(key, raw));
}

/** Автовыбор класса по объёму (§3): A<15→B<35→C, с перебором активных. */
export function classForVolume(db: Database.Database, volumeM3: number): VehicleClass {
  const classes = db.prepare("SELECT class, capacity_m3 FROM vehicle_classes WHERE active = 1 ORDER BY capacity_m3").all() as
    { class: string; capacity_m3: number }[];
  for (const c of classes) {
    if (c.class === "A" || c.class === "B" || c.class === "C") {
      if (volumeM3 <= c.capacity_m3) return c.class;
    }
  }
  return "C";
}

// ---------------------------------------------------------------------------
// Демо-данные (идемпотентно)
// ---------------------------------------------------------------------------

const DEMO_PASSWORD = "demo1234";

function seed(db: Database.Database): void {
  const userCount = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (userCount === 0) {
    const now = Math.floor(Date.now() / 1000);
    const hash = hashPassword(DEMO_PASSWORD);
    const ins = db.prepare(
      "INSERT INTO users (email, name, role, password_hash, active, email_verified, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)",
    );
    ins.run("klient@example.com", "Анна Сафрова", "kunde", hash, now);
    ins.run("logist@example.com", "Сергей Волков", "logist", hash, now);
    ins.run("voditel@example.com", "Мурат Джан", "driver", hash, now);
    ins.run("voditel2@example.com", "Окан Еылмаз", "driver", hash, now);
    ins.run("buh@example.com", "Петра Андерс", "finance", hash, now);
    ins.run("admin@example.com", "Маркус Фогель", "admin", hash, now);
  }

  const classCount = (db.prepare("SELECT COUNT(*) AS n FROM vehicle_classes").get() as { n: number }).n;
  if (classCount === 0) {
    const ins = db.prepare(
      "INSERT INTO vehicle_classes (class, label, capacity_m3, included_m3, base_cents) VALUES (?, ?, ?, ?, ?)",
    );
    ins.run("A", "Transporter 3,5 т", 15, 10, DEFAULT_TARIFFS.classes.A.baseCents);
    ins.run("B", "LKW 7,5 т", 35, 20, DEFAULT_TARIFFS.classes.B.baseCents);
    ins.run("C", "LKW 12 т", 55, 40, DEFAULT_TARIFFS.classes.C.baseCents);
  }

  const vehicleCount = (db.prepare("SELECT COUNT(*) AS n FROM vehicles").get() as { n: number }).n;
  if (vehicleCount === 0) {
    const ins = db.prepare("INSERT INTO vehicles (plate, class, label, capacity_m3, active) VALUES (?, ?, ?, ?, 1)");
    ins.run("B-MA 1001", "A", "Transporter 3,5 т", 15);
    ins.run("B-MA 2002", "B", "LKW 7,5 т", 35);
    ins.run("B-MA 3003", "B", "LKW 7,5 т", 35);
    ins.run("B-MA 4004", "C", "LKW 12 т", 55);
  }

  // cfgCount===0 → первичный seed; иначе backfill недостающих ключей (D8.1, INSERT OR IGNORE)
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
    "pricing.quote_valid_days": String(DEFAULT_TARIFFS.quoteValidDays),
    "finance.due_days": "14",
    "company.name": "Помощник с переездом GmbH",
    "maps.api_key": "",
  };
  // cfgCount===0 → первичный seed; иначе backfill недостающих ключей (D8.1, INSERT OR IGNORE)
  const cfgIns = db.prepare("INSERT OR IGNORE INTO config (key, value, updated_at) VALUES (?, ?, ?)");
  const now = Math.floor(Date.now() / 1000);
  for (const [k, v] of Object.entries(defaults)) cfgIns.run(k, v, now);
}

// ---------------------------------------------------------------------------
// Сессии (D3-финал): токен 32 байта, в БД только sha256, TTL 12ч от логина
// ---------------------------------------------------------------------------

export const SESSION_TTL_S = 12 * 3600;

export function createSession(db: Database.Database, userId: number): { token: string; expiresAt: number } {
  // Ленивая чистка просроченных строк — при каждом входе (D3)
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Math.floor(Date.now() / 1000));
  const token = newToken();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(sha256(token), userId, expiresAt, Math.floor(Date.now() / 1000));
  return { token, expiresAt };
}

/** Атомарная ротация (D3): UPDATE по тому же id сессии, внутри транзакции вызывающего. */
export function rotateSession(db: Database.Database, oldToken: string): { token: string; expiresAt: number } {
  const token = newToken();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  db.prepare("UPDATE sessions SET token_hash = ?, expires_at = ?, created_at = ? WHERE token_hash = ?")
    .run(sha256(token), expiresAt, Math.floor(Date.now() / 1000), sha256(oldToken));
  return { token, expiresAt };
}

export function deleteSession(db: Database.Database, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

/** Инвалидация всех сессий пользователя — только при смене пароля (D3). */
export function invalidateUserSessions(db: Database.Database, userId: number): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
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

/** Детерминированная хеш-строка протокола (D6.2): порядок фиксирован. */
export function protocolHashString(p: {
  orderId: number; loadedJson: string; deviation: number;
  notes: string; signature: string; prevHash: string; signedAt: number;
}): string {
  return [
    p.orderId, p.loadedJson, p.deviation,
    p.notes, p.signature, p.prevHash, p.signedAt,
  ].join("|");
}

/** D6.11: пересчёт всей цепочки — без верификации хеши были бы декорацией. */
export function verifyChain(db: Database.Database): { valid: boolean; brokenAt?: number; count: number } {
  const rows = db.prepare("SELECT * FROM protocol ORDER BY id ASC").all() as ProtocolRow[];
  let prev = "GENESIS";
  for (const r of rows) {
    const expect = sha256(protocolHashString({
      orderId: r.order_id,
      loadedJson: r.loaded_json,
      deviation: r.deviation_m3,
      notes: r.notes,
      signature: r.signature,
      prevHash: r.prev_hash,
      signedAt: r.signed_at,
    }));
    if (r.prev_hash !== prev || r.hash !== expect) {
      return { valid: false, brokenAt: r.id, count: rows.length };
    }
    prev = r.hash;
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

/** Бизнес-событие заказа: пишется в order_history (для клиента) + audit (compliance). */
export function logOrderEvent(
  db: Database.Database,
  orderId: number,
  actor: SessionUser,
  action: string,
  details: Record<string, unknown>,
  opts?: { clientVisible?: boolean },
): void {
  const json = JSON.stringify(details);
  db.prepare(
    "INSERT INTO order_history (order_id, at, actor_user_id, actor_role, action, client_visible, details) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(orderId, Math.floor(Date.now() / 1000), actor.id, actor.role, action, opts?.clientVisible === false ? 0 : 1, json);
  audit(db, actor.id, action, "order", String(orderId), json.slice(0, 200));
}

/** Сохранить снимок как новую версию (append-only); вернуть номер версии. */
export function saveSnapshotVersion(db: Database.Database, orderId: number, snapshotJson: string, grossCents: number, actorUserId: number | null): number {
  const cur = db.prepare("SELECT COALESCE(MAX(version),0) AS v FROM quote_snapshots WHERE order_id = ?").get(orderId) as { v: number };
  const version = cur.v + 1;
  db.prepare(
    "INSERT INTO quote_snapshots (order_id, version, snapshot_json, gross_cents, at, actor_user_id) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(orderId, version, snapshotJson, grossCents, Math.floor(Date.now() / 1000), actorUserId);
  db.prepare("UPDATE orders SET current_version = ? WHERE id = ?").run(version, orderId);
  return version;
}

export interface SnapshotVersionRow {
  version: number;
  gross_cents: number;
  at: number;
}

/** История цен заказа (для аккордеона «Предыдущие цены»). */
export function snapshotVersions(db: Database.Database, orderId: number): SnapshotVersionRow[] {
  return db.prepare("SELECT version, gross_cents, at FROM quote_snapshots WHERE order_id = ? ORDER BY version DESC")
    .all(orderId) as SnapshotVersionRow[];
}

/** История заказа: клиент видит только client_visible=1. */
export function orderHistory(db: Database.Database, orderId: number, includeHidden = false): HistoryRow[] {
  return db.prepare(
    `SELECT * FROM order_history WHERE order_id = ? ${includeHidden ? "" : "AND client_visible = 1"} ORDER BY id DESC LIMIT 100`,
  ).all(orderId) as HistoryRow[];
}

export interface AllHistoryRow extends HistoryRow {
  ref: string;
}

/** Полная история изменений всех заказов (админ, D10): включая client_visible=0. */
export function listAllOrderHistory(db: Database.Database, limit = 100): AllHistoryRow[] {
  return db.prepare(
    `SELECT h.*, o.ref FROM order_history h JOIN orders o ON o.id = h.order_id ORDER BY h.id DESC LIMIT ?`,
  ).all(limit) as AllHistoryRow[];
}

/** Поиск сессии по сырому токену. Активность пользователя проверяется на каждый запрос (D3). */
export function findSession(db: Database.Database, token: string): SessionUser | null {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.active, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  ).get(sha256(token)) as { id: number; email: string; name: string; role: SessionUser["role"]; active: number; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
  if (!row.active) return null; // деактивация действует немедленно
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}
