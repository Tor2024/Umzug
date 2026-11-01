// «Помощник с переездом» — единственный источник расчёта денег.
// Правила: целые центы; порядок subtotal → скидка → коэффициенты → нетто → НДС → брутто → аванс (D1.1).
// Тарифы приходят параметром (Tariffs) — движок ничего не читает из БД сам.

export type VehicleClass = "A" | "B" | "C";

/** Тарифный срез (из config на момент расчёта; попадает в снимок заказа). */
export interface Tariffs {
  // Классы машин
  classes: Record<VehicleClass, { label: string; capacityM3: number; includedM3: number; baseCents: number }>;
  // Экипаж
  crewHourlyCents: number;      // ставка за грузчика в час
  crewCount: number;            // грузчиков по умолчанию
  hoursPerM3: number;           // часов работы бригады на м³ (погрузка ИЛИ разгрузка)
  minCrewHours: number;         // минимальные часы бригады на фазу
  // Дорога
  perKmCents: number;           // за км сверх бесплатных
  freeKm: number;
  avgSpeedKmh: number;          // fallback длительности дороги (Google duration primary)
  // Прочее
  floorCents: number;           // за этаж за направление (без лифта)
  elevatorCents: number;        // за направление (лифт)
  extraM3Cents: number;         // за м³ сверх включённого (только при несоответствии класса, D1.4)
  boxCents: number;             // за картон
  packHourlyCents: number;      // упаковка: час работы грузчика
  kitchenCents: number;         // кухонная сборка (комплект)
  furnitureCents: number;       // разбор/сбор одного предмета мебели
  hvzZoneCents: number;         // HVZ за зону (админ + таблички)
  // Проценты, целые числа
  vatPct: number;               // 19; 0 при § 19 UStG
  vatEnabled: boolean;          // false → малый бизнес § 19 UStG
  depositPct: number;           // 30
  weekendPct: number;           // +10 (суббота/праздник)
  expressPct: number;           // +25 (переезд в течение 48ч от заказа)
  sharedLoadPct: number;        // −15 (догруз), применяется ПЕРВЫМ к subtotal
  seasonPct: number;            // сезонный коэффициент месяца (0 = нейтрально)
  loadPct: number;              // ручной коэффициент загрузки даты (D1.5)
  quoteValidDays: number;       // снимок цены валиден N дней
}

/** Входные данные расчёта. */
export interface MoveConfig {
  vehicleClass: VehicleClass;
  /** Ручной выбор класса (несоответствие объёму) → доплата за м³ сверх включённого. */
  classForced?: boolean;
  volumeM3: number;
  distanceKm: number;
  durationMin?: number;         // от Google; если нет — km/avgSpeed
  floorsFrom: number;           // 0 = EG
  floorsTo: number;
  elevatorFrom: boolean;
  elevatorTo: boolean;
  boxes: number;
  kitchen: boolean;
  furnitureItems: number;       // предметов на разбор/сбор
  packHours: number;            // часов упаковки (0 = нет)
  hvzZones: number;             // 0–2
  extraCrew: number;            // дополнительные грузчики сверх crewCount
  moveDate: string;             // ISO yyyy-mm-dd
  isHoliday?: boolean;          // немецкий праздник (данные)
  express?: boolean;
  sharedLoad?: boolean;
}

export interface LineItem {
  key: string;
  label: string;
  amount: number;               // целые центы
  meta?: Record<string, string | number>;
}

export interface Quote {
  lines: LineItem[];
  subtotal: number;
  discount: number;
  multiplierPct: number;        // суммарный процентный множитель (для снимка)
  net: number;
  vat: number;
  gross: number;
  deposit: number;
  remainder: number;
  crewHoursLoad: number;
  crewHoursDrive: number;
  workHours: number;            // погрузка+дорога+разгрузка
  needsSecondDriver: boolean;   // смена > 10 ч
}

/** Немецкие праздники (федеральные, общие для всех земель) — данные (D1.10). */
export const DE_HOLIDAYS_2026: string[] = [
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14",
  "2026-05-25", "2026-06-04", "2026-10-03", "2026-12-25", "2026-12-26",
];

export class ValidationError extends Error {}

/** Валидация входа (шаг 1.5). Воскресенье запрещено (§ 9 ArbZG, запрет >7,5 т вс). */
export function validateConfig(cfg: MoveConfig): void {
  if (!(cfg.volumeM3 >= 1 && cfg.volumeM3 <= 55)) throw new ValidationError("Объём должен быть 1–55 м³");
  if (!(cfg.distanceKm >= 0 && cfg.distanceKm <= 3000)) throw new ValidationError("Дистанция 0–3000 км");
  if (!(cfg.floorsFrom >= 0 && cfg.floorsFrom <= 10 && cfg.floorsTo >= 0 && cfg.floorsTo <= 10))
    throw new ValidationError("Этажи 0–10");
  if (!(cfg.hvzZones >= 0 && cfg.hvzZones <= 2)) throw new ValidationError("HVZ 0–2 зоны");
  if (!(cfg.boxes >= 0 && cfg.boxes <= 500)) throw new ValidationError("Картоны 0–500");
  if (!(cfg.extraCrew >= 0 && cfg.extraCrew <= 5)) throw new ValidationError("Грузчики 0–5 доп.");
  if (!(cfg.packHours >= 0 && cfg.packHours <= 100)) throw new ValidationError("Упаковка 0–100 часов");
  if (!(cfg.furnitureItems >= 0 && cfg.furnitureItems <= 100)) throw new ValidationError("Мебель 0–100 предметов");
  const d = new Date(cfg.moveDate + "T12:00:00");
  if (Number.isNaN(d.getTime())) throw new ValidationError("Некорректная дата");
  if (d.getDay() === 0) throw new ValidationError("Воскресенье недоступно (§ 9 ArbZG)");
  if (DE_HOLIDAYS_2026.includes(cfg.moveDate)) throw new ValidationError("Праздничный день недоступен");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d < today) throw new ValidationError("Дата в прошлом");
}

/**
 * Главная формула (D1.1):
 *   subtotal = Σ line            (каждая позиция округлена на месте)
 *   discount = round(subtotal × sharedLoadPct)
 *   mult     = season + weekend + load + express (проценты складываются в один множитель)
 *   net      = round((subtotal − discount) × (1 + mult/100))
 *   vat      = round(net × vatPct/100)   — один раз
 *   gross    = net + vat
 *   deposit  = round(gross × depositPct)
 */
export function calculateQuote(cfg: MoveConfig, t: Tariffs): Quote {
  validateConfig(cfg);
  const lines: LineItem[] = [];
  const cls = t.classes[cfg.vehicleClass];

  // 1. База класса
  lines.push({
    key: "base", label: `База (${cls.label})`, amount: cls.baseCents,
    meta: { class: cfg.vehicleClass, capacityM3: cls.capacityM3 },
  });

  // 2. Экипаж: погрузка + дорога + разгрузка (D1.2/D1.3)
  const crew = t.crewCount + cfg.extraCrew;
  const hoursLoad = Math.max(t.minCrewHours, cfg.volumeM3 * t.hoursPerM3);
  const hoursUnload = hoursLoad;
  const driveHours = cfg.durationMin ? cfg.durationMin / 60 : cfg.distanceKm / t.avgSpeedKmh;
  const workHours = hoursLoad + driveHours + hoursUnload;
  const crewAmount = Math.round(workHours * crew * t.crewHourlyCents);
  lines.push({
    key: "crew", label: "Экипаж", amount: crewAmount,
    meta: { hours: round2(workHours), crew, rateCents: t.crewHourlyCents },
  });

  // 3. Дорога: км сверх бесплатных (топливо/износ)
  const billableKm = Math.max(0, cfg.distanceKm - t.freeKm);
  if (billableKm > 0) {
    lines.push({
      key: "distance", label: "Дорога", amount: Math.round(billableKm * t.perKmCents),
      meta: { km: round2(billableKm), freeKm: t.freeKm },
    });
  }

  // 4. Доп. объём — ТОЛЬКО при ручном (несоответствующем) классе (D1.4)
  const extraM3 = cfg.classForced ? Math.max(0, cfg.volumeM3 - cls.includedM3) : 0;
  if (extraM3 > 0) {
    lines.push({
      key: "extraVolume", label: "Доп. объём", amount: Math.round(extraM3 * t.extraM3Cents),
      meta: { m3: round2(extraM3) },
    });
  }

  // 5. Этажи и лифт (за направление)
  const floorCharge = (floors: number, elevator: boolean): number =>
    elevator ? t.elevatorCents : floors * t.floorCents;
  const fromCharge = floorCharge(cfg.floorsFrom, cfg.elevatorFrom);
  const toCharge = floorCharge(cfg.floorsTo, cfg.elevatorTo);
  if (fromCharge) lines.push({ key: "floorFrom", label: "Подъём (откуда)", amount: fromCharge });
  if (toCharge) lines.push({ key: "floorTo", label: "Спуск (куда)", amount: toCharge });

  // 6. Картоны
  if (cfg.boxes > 0) {
    lines.push({ key: "boxes", label: "Картоны", amount: cfg.boxes * t.boxCents, meta: { count: cfg.boxes } });
  }

  // 7. Упаковка (часы грузчиков)
  if (cfg.packHours > 0) {
    lines.push({
      key: "packing", label: "Упаковка", amount: Math.round(cfg.packHours * crew * t.packHourlyCents),
      meta: { hours: round2(cfg.packHours), crew },
    });
  }

  // 8. Сборка: кухня комплектом, мебель за предмет
  if (cfg.kitchen) lines.push({ key: "kitchen", label: "Сборка кухни", amount: t.kitchenCents });
  if (cfg.furnitureItems > 0) {
    lines.push({
      key: "furniture", label: "Разбор/сбор мебели", amount: cfg.furnitureItems * t.furnitureCents,
      meta: { count: cfg.furnitureItems },
    });
  }

  // 9. HVZ
  if (cfg.hvzZones > 0) {
    lines.push({ key: "hvz", label: "Halteverbotszone", amount: cfg.hvzZones * t.hvzZoneCents, meta: { zones: cfg.hvzZones } });
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);

  // 10. Скидка (догруз) — первой, к subtotal (D1.1)
  const discount = cfg.sharedLoad ? Math.round(subtotal * t.sharedLoadPct / 100) : 0;

  // 11. Коэффициенты спроса — один множитель (D1.1, D1.5)
  const multiplierPct = t.seasonPct + t.loadPct +
    (isWeekend(cfg) ? t.weekendPct : 0) +
    (cfg.express ? t.expressPct : 0);
  const net = Math.round((subtotal - discount) * (1 + multiplierPct / 100));

  // 12. НДС один раз; § 19 UStG — vatEnabled=false
  const vat = t.vatEnabled ? Math.round(net * t.vatPct / 100) : 0;
  const gross = net + vat;
  const deposit = Math.round(gross * t.depositPct / 100);

  return {
    lines, subtotal, discount, multiplierPct, net, vat, gross, deposit,
    remainder: gross - deposit,
    crewHoursLoad: round2(hoursLoad),
    crewHoursDrive: round2(driveHours),
    workHours: round2(workHours),
    needsSecondDriver: workHours > 10,
  };
}

function isWeekend(cfg: MoveConfig): boolean {
  const d = new Date(cfg.moveDate + "T12:00:00");
  return d.getDay() === 6 || !!cfg.isHoliday; // суббота или праздник (вс исключён валидацией)
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Воспроизведение из снимка: recalculate(snapshot) должен давать тот же gross (контрольный тест 1.6). */
export interface QuoteSnapshot {
  snapshotVersion: 1;
  config: MoveConfig;
  tariffs: Tariffs;
  quoteValidUntil: string;
}

export function makeSnapshot(cfg: MoveConfig, t: Tariffs, now = new Date()): QuoteSnapshot {
  const until = new Date(now);
  until.setDate(until.getDate() + t.quoteValidDays);
  return { snapshotVersion: 1, config: structuredClone(cfg), tariffs: structuredClone(t), quoteValidUntil: until.toISOString().slice(0, 10) };
}

export function recalculate(snap: QuoteSnapshot): Quote {
  if (snap.snapshotVersion !== 1) throw new ValidationError(`Неизвестная версия снимка: ${snap.snapshotVersion}`);
  return calculateQuote(snap.config, snap.tariffs); // тарифы ТОЛЬКО из снимка (D4.10)
}

/** Демо-тарифы по умолчанию (записываются в config при первом старте; здесь — для тестов). */
export const DEFAULT_TARIFFS: Tariffs = {
  classes: {
    A: { label: "Transporter 3,5 т", capacityM3: 15, includedM3: 10, baseCents: 34_000 },
    B: { label: "LKW 7,5 т", capacityM3: 35, includedM3: 20, baseCents: 54_000 },
    C: { label: "LKW 12 т", capacityM3: 55, includedM3: 40, baseCents: 89_000 },
  },
  crewHourlyCents: 2900, crewCount: 2, hoursPerM3: 0.25, minCrewHours: 2,
  perKmCents: 80, freeKm: 31, avgSpeedKmh: 80,
  floorCents: 3500, elevatorCents: 6000, extraM3Cents: 1490,
  boxCents: 450, packHourlyCents: 2900, kitchenCents: 18000, furnitureCents: 3500,
  hvzZoneCents: 9490,
  vatPct: 19, vatEnabled: true, depositPct: 30,
  weekendPct: 10, expressPct: 25, sharedLoadPct: 15,
  seasonPct: 0, loadPct: 0, quoteValidDays: 14,
};
