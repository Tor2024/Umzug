// D11: Доступность дат — единый источник истины (календарь + серверная валидация заявок).
// busy = assignments JOIN orders status IN confirmed/assigned/enroute; new НЕ резервирует
// (идёт в pendingOrders — арбитраж у логиста, критик 1/п.1).
// Long-haul рейс (586 км) = 1 занятый день — задокументировано, многодневность не моделируем (критик 2/MED 8).

import type { DB } from "./db";

export type DayStatus = "free" | "partial" | "busy" | "closed";

export interface DayAvailability {
  status: DayStatus;
  freeVehicles: number;   // свободные машины ВСЕГО
  freeDrivers: number;    // свободные водители
  freeSuitable: number;   // свободные машины подходящего класса (по объёму)
  pendingOrders: number;  // new-заявок на дату (не резервируют)
  maxVehicles: number;
  maxDrivers: number;
  /** Задача 6: авто-коэффициент загрузки этой даты (заполняется API; 0 = выключено) */
  autoLoadPct?: number;
}

export interface MonthAvailability {
  month: string;               // YYYY-MM
  today: string;               // ISO (Berlin)
  minMonth: string;            // нижняя граница листания
  maxMonth: string;            // верхняя (сегодня +3 мес, критик 2/MINOR 11)
  holidays: string[];          // попавшие в месяц
  sundays: string[];           // попавшие в месяц (closed)
  dates: Record<string, DayAvailability>;
}

/** Праздники: алгоритмически через @/lib/holidays (любой год, федеральные 9 дат). */
import { germanHolidays, isHoliday } from "./holidays";

/** Обратная совместимость: список праздников для года. */
export function DE_HOLIDAYS(year = new Date().getFullYear()): string[] {
  return germanHolidays(year);
}

/** Сегодняшняя дата по Europe/Berlin (якорь, не UTC-полночь — критик 1/таймзона). */
export function todayIsoBerlin(now?: Date): string {
  const d = now ?? new Date();
  const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }); // sv-SE даёт YYYY-MM-DD
  return fmt.format(d);
}

function isSunday(iso: string): boolean {
  return new Date(iso + "T12:00:00Z").getUTCDay() === 0;
}

export function isClosedDay(iso: string, today?: string): boolean {
  return isSunday(iso) || isHoliday(iso) || iso < (today ?? todayIsoBerlin());
}

/** Все дни месяца как ISO-массив. */
function daysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) =>
    `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}

/**
 * Свободные ресурсы на дату: машины/водители минус занятые в confirmed/assigned/enroute.
 * single source of truth — используется и календарём, и createOrderAction (критик 2/HIGH 6).
 */
export async function resourceBookings(db: DB, dateIso: string): Promise<{
  busyVehicleIds: number[];
  busyDriverIds: number[];
  pendingOrders: number;
}> {
  const busyRes = await db.execute({
    sql: `SELECT a.resource_type, a.resource_id FROM assignments a
          JOIN orders o ON o.id = a.order_id
          WHERE a.move_date = ? AND o.status IN ('confirmed','assigned','enroute')`,
    args: [dateIso],
  });
  const busy = busyRes.rows as unknown as Array<{ resource_type: string; resource_id: number }>;
  const vehicleIds = busy.filter((r) => r.resource_type === "vehicle").map((r) => Number(r.resource_id));
  const driverIds = busy.filter((r) => r.resource_type === "driver").map((r) => Number(r.resource_id));
  const pendingRes = await db.execute({
    sql: "SELECT COUNT(*) AS c FROM orders WHERE move_date = ? AND status = 'new'",
    args: [dateIso],
  });
  return { busyVehicleIds: vehicleIds, busyDriverIds: driverIds, pendingOrders: Number((pendingRes.rows[0] as unknown as { c: number }).c) };
}

/** Минимальный класс машины для объёма (A<15≤B<35≤C; по вместимости классов). */
export function minClassForVolume(volumeM3: number): "A" | "B" | "C" {
  if (volumeM3 <= 15) return "A";
  if (volumeM3 <= 35) return "B";
  return "C";
}

const CLASS_RANK = { A: 1, B: 2, C: 3 } as const;

/**
 * Доступность одного дня под конкретную заявку (объём + needsSecond).
 * effectiveFree = min(свободные машины подходящего класса, свободные водители − neededDrivers) — критик 1.
 */
export async function dayAvailability(
  db: DB,
  dateIso: string,
  opts: { volumeM3?: number; needsSecond?: boolean },
): Promise<DayAvailability> {
  const vRes = await db.execute("SELECT id, class FROM vehicles WHERE active = 1");
  const vehicles = vRes.rows as unknown as Array<{ id: number; class: "A" | "B" | "C" }>;
  const dRes = await db.execute("SELECT id FROM users WHERE role = 'driver' AND active = 1");
  const drivers = dRes.rows as unknown as Array<{ id: number }>;
  const { busyVehicleIds, busyDriverIds, pendingOrders } = await resourceBookings(db, dateIso);
  const minClass = opts.volumeM3 !== undefined ? minClassForVolume(opts.volumeM3) : null;
  const freeVehicles = vehicles.filter((v) => !busyVehicleIds.includes(v.id));
  const freeDrivers = drivers.filter((d) => !busyDriverIds.includes(d.id)).length;
  const freeSuitable = minClass
    ? freeVehicles.filter((v) => CLASS_RANK[v.class] >= CLASS_RANK[minClass]).length
    : freeVehicles.length;
  const neededDrivers = opts.needsSecond ? 2 : 1;
  const effectiveFree = Math.min(freeSuitable, Math.max(0, freeDrivers - (neededDrivers - 1)));
  const status: DayStatus =
    effectiveFree <= 0 ? "busy" : effectiveFree === 1 ? "partial" : "free";
  return {
    status, freeVehicles: freeVehicles.length, freeDrivers, freeSuitable,
    pendingOrders, maxVehicles: vehicles.length, maxDrivers: drivers.length,
  };
}

/** Календарь месяца: [сегодня, сегодня+3 мес] границы; closed = воскресенье/праздник/прошлое. */
export async function monthAvailability(
  db: DB,
  month: string,
  opts: { volumeM3?: number; needsSecond?: boolean } = {},
): Promise<MonthAvailability> {
  const today = todayIsoBerlin();
  const minMonth = today.slice(0, 7);
  const maxDate = new Date(today + "T12:00:00Z");
  maxDate.setUTCMonth(maxDate.getUTCMonth() + 3);
  const maxMonth = `${maxDate.getUTCFullYear()}-${String(maxDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const clamped = month < minMonth ? minMonth : month > maxMonth ? maxMonth : month;
  const dates: Record<string, DayAvailability> = {};
  const sundays: string[] = [];
  const holidays: string[] = [];
  for (const iso of daysOfMonth(clamped)) {
    if (isClosedDay(iso, today)) {
      dates[iso] = { status: "closed", freeVehicles: 0, freeDrivers: 0, freeSuitable: 0, pendingOrders: 0, maxVehicles: 0, maxDrivers: 0 };
      if (isHoliday(iso)) holidays.push(iso);
      if (isSunday(iso)) sundays.push(iso);
      continue;
    }
    dates[iso] = await dayAvailability(db, iso, opts);
  }
  return { month: clamped, today, minMonth, maxMonth, holidays, sundays, dates };
}

/** Ближайшая свободная дата от заданной (для express-подсказки, критик 2/MED 7). */
export async function nearestFreeDate(
  db: DB,
  fromIso: string,
  opts: { volumeM3?: number; needsSecond?: boolean } = {},
): Promise<string | null> {
  const today = todayIsoBerlin();
  let iso = fromIso < today ? today : fromIso;
  for (let i = 0; i < 90; i++) {
    if (!isClosedDay(iso, today)) {
      const a = await dayAvailability(db, iso, opts);
      if (a.status !== "busy") return iso;
    }
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    iso = d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Авто-коэффициент загрузки дня (задача 6, D1.5): чистая функция от статуса дня.
 * busy → maxPct, partial → half, free/closed → 0. maxPct=0 → всегда 0 (выключено).
 */
export function loadFactorPct(av: DayAvailability, maxPct: number): number {
  if (maxPct <= 0) return 0;
  if (av.status === "busy") return maxPct;
  if (av.status === "partial") return Math.round(maxPct / 2);
  return 0;
}
