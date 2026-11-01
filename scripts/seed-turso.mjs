// Идемпотентный seed демо-данных в Turso (повторяет seed() из src/lib/db.ts).
// Запуск: node scripts/seed-turso.mjs
// Требует env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
import { createClient } from "@libsql/client";
import { randomBytes, scryptSync } from "node:crypto";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, Buffer.from(salt, "hex"), 32);
  return `${salt}:${hash.toString("hex")}`;
}

function count(table) {
  return db.execute(`SELECT COUNT(*) AS n FROM ${table}`).then((r) => Number(r.rows[0].n));
}

async function main() {
  const DEMO_PASSWORD = "demo1234";
  const now = Math.floor(Date.now() / 1000);

  // users
  if ((await count("users")) === 0) {
    const hash = hashPassword(DEMO_PASSWORD);
    const users = [
      ["klient@example.com", "Анна Сафрова", "kunde"],
      ["logist@example.com", "Сергей Волков", "logist"],
      ["voditel@example.com", "Мурат Джан", "driver"],
      ["voditel2@example.com", "Окан Еылмаз", "driver"],
      ["buh@example.com", "Петра Андерс", "finance"],
      ["admin@example.com", "Маркус Фогель", "admin"],
    ];
    for (const [email, name, role] of users) {
      await db.execute({
        sql: "INSERT INTO users (email, name, role, password_hash, active, email_verified, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)",
        args: [email, name, role, hash, now],
      });
    }
    console.log("users: inserted 6 demo users");
  } else {
    console.log("users: not empty, skip");
  }

  // vehicle_classes
  if ((await count("vehicle_classes")) === 0) {
    const classes = [
      ["A", "Transporter 3,5 т", 15, 10, 34000],
      ["B", "LKW 7,5 т", 35, 20, 54000],
      ["C", "LKW 12 т", 55, 40, 89000],
    ];
    for (const [cl, label, cap, incl, base] of classes) {
      await db.execute({
        sql: "INSERT INTO vehicle_classes (class, label, capacity_m3, included_m3, base_cents) VALUES (?, ?, ?, ?, ?)",
        args: [cl, label, cap, incl, base],
      });
    }
    console.log("vehicle_classes: inserted A/B/C");
  } else {
    console.log("vehicle_classes: not empty, skip");
  }

  // vehicles
  if ((await count("vehicles")) === 0) {
    const vehicles = [
      ["B-MA 1001", "A", "Transporter 3,5 т", 15],
      ["B-MA 2002", "B", "LKW 7,5 т", 35],
      ["B-MA 3003", "B", "LKW 7,5 т", 35],
      ["B-MA 4004", "C", "LKW 12 т", 55],
    ];
    for (const [plate, cl, label, cap] of vehicles) {
      await db.execute({
        sql: "INSERT INTO vehicles (plate, class, label, capacity_m3, active) VALUES (?, ?, ?, ?, 1)",
        args: [plate, cl, label, cap],
      });
    }
    console.log("vehicles: inserted 4");
  } else {
    console.log("vehicles: not empty, skip");
  }

  // config
  const defaults = {
    "pricing.crew_hourly_cents": "2900",
    "pricing.crew_count": "2",
    "pricing.hours_per_m3": "25",
    "pricing.min_crew_hours": "2",
    "pricing.per_km_cents": "80",
    "pricing.free_km": "31",
    "pricing.avg_speed_kmh": "80",
    "pricing.floor_cents": "3500",
    "pricing.elevator_cents": "6000",
    "pricing.extra_m3_cents": "1490",
    "pricing.box_cents": "450",
    "pricing.pack_hourly_cents": "2900",
    "pricing.kitchen_cents": "18000",
    "pricing.furniture_cents": "3500",
    "pricing.hvz_zone_cents": "9490",
    "pricing.vat_pct": "19",
    "pricing.vat_enabled": "1",
    "pricing.deposit_pct": "30",
    "pricing.weekend_pct": "10",
    "pricing.express_pct": "25",
    "pricing.shared_load_pct": "15",
    "pricing.season_pct": "0",
    "pricing.load_pct": "0",
    "pricing.quote_valid_days": "14",
    "finance.due_days": "14",
    "company.name": "Помощник с переездом GmbH",
    "maps.api_key": "",
  };
  const before = await count("config");
  for (const [k, v] of Object.entries(defaults)) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO config (key, value, updated_at) VALUES (?, ?, ?)",
      args: [k, v, now],
    });
  }
  const after = await count("config");
  console.log(`config: ${before} -> ${after}`);

  console.log("SEED_DONE");
}

main().catch((e) => {
  console.error("SEED_FAIL", e);
  process.exit(1);
});
