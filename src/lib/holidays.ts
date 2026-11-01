/**
 * Немецкие праздники (федеральные, общие для всех земель) — единый источник.
 * Вычисляются алгоритмически через дату Пасхи (алгоритм Гаусса/Бутчера),
 * поэтому покрывают любой год, а не только 2026–2027 (задача «праздники 2028+»).
 *
 * Список федеральных (ganz Deutschland): Neujahr, Karfreitag, Ostermontag,
 * Tag der Arbeit, Christi Himmelfahrt, Pfingstmontag, Tag der Deutschen Einheit,
 * 1. und 2. Weihnachtstag — 9 дней в году.
 * Региональные (Fronleichnam, Epiphanias, Allerheiligen, Buß- und Bettag,
 * Weltkindertag, Reformationstag) — сознательно не включены: сервис работает
 * по всей стране, запрещать общий день из-за одной земли нельзя.
 */

/** Католическая/протестантская Пасха по алгоритму Бутчера (григорианский календарь). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const HOLIDAY_CACHE = new Map<number, string[]>();

/** Федеральные праздники Германии года year (9 дат, YYYY-MM-DD по возрастанию). */
export function germanHolidays(year: number): string[] {
  const cached = HOLIDAY_CACHE.get(year);
  if (cached) return cached;
  const easter = easterSunday(year);
  const list = [
    `${year}-01-01`, // Neujahr
    addDaysIso(easter, -2), // Karfreitag
    addDaysIso(easter, 1), // Ostermontag
    `${year}-05-01`, // Tag der Arbeit
    addDaysIso(easter, 39), // Christi Himmelfahrt
    addDaysIso(easter, 50), // Pfingstmontag
    `${year}-10-03`, // Tag der Deutschen Einheit
    `${year}-12-25`, // 1. Weihnachtstag
    `${year}-12-26`, // 2. Weihnachtstag
  ];
  HOLIDAY_CACHE.set(year, list);
  return list;
}

const HOLIDAY_SET = new Set<string>();
function inSet(iso: string): boolean {
  if (HOLIDAY_SET.size === 0) {
    const year = Number(iso.slice(0, 4));
    for (let y = year - 1; y <= year + 1; y++) germanHolidays(y).forEach((d) => HOLIDAY_SET.add(d));
  } else {
    const year = Number(iso.slice(0, 4));
    if (!germanHolidays(year).includes(iso)) return false;
    return true;
  }
  return HOLIDAY_SET.has(iso);
}

/** Проверка: дата — федеральный праздник (работает для любого года). */
export function isHoliday(iso: string): boolean {
  return inSet(iso);
}
