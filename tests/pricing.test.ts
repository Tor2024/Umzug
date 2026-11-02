import { describe, it, expect } from "vitest";
import {
  calculateQuote,
  validateConfig,
  makeSnapshot,
  recalculate,
  DEFAULT_TARIFFS,
  type Tariffs,
  type MoveConfig,
} from "../src/lib/pricing";
import { loadFactorPct, type DayAvailability, type DayStatus } from "../src/lib/availability";

const T: Tariffs = structuredClone(DEFAULT_TARIFFS);

/** Базовый конфиг: 20 м³, 100 км, 1-й этаж на оба конца, без опций. */
function cfg(over: Partial<MoveConfig> = {}): MoveConfig {
  return {
    vehicleClass: "B",
    volumeM3: 20,
    distanceKm: 100,
    floorsFrom: 1,
    floorsTo: 1,
    elevatorFrom: false,
    elevatorTo: false,
    boxes: 0,
    kitchen: false,
    furnitureItems: 0,
    packHours: 0,
    hvzZones: 0,
    extraCrew: 0,
    moveDate: "2026-11-03", // вторник — не выходной
    ...over,
  };
}

describe("validateConfig", () => {
  it("принимает корректный конфиг", () => {
    expect(() => validateConfig(cfg())).not.toThrow();
  });

  it("отклоняет объём вне 1–55", () => {
    expect(() => validateConfig(cfg({ volumeM3: 0 }))).toThrow(/объём/i);
    expect(() => validateConfig(cfg({ volumeM3: 56 }))).toThrow();
  });

  it("отклоняет расстояние вне 0–3000 км", () => {
    expect(() => validateConfig(cfg({ distanceKm: 3001 }))).toThrow();
  });

  it("отклоняет этажи вне 0–10", () => {
    expect(() => validateConfig(cfg({ floorsFrom: 11 }))).toThrow();
    expect(() => validateConfig(cfg({ floorsTo: -1 }))).toThrow();
  });

  it("отклоняет воскресенье (§ 9 ArbZG)", () => {
    // 2026-11-08 — воскресенье
    expect(() => validateConfig(cfg({ moveDate: "2026-11-08" }))).toThrow(/воскресенье/i);
  });

  it("отклоняет федеральный праздник", () => {
    // 2026-12-25 — 1. Weihnachtstag
    expect(() => validateConfig(cfg({ moveDate: "2026-12-25" }))).toThrow();
  });

  it("отклоняет дату в прошлом", () => {
    expect(() => validateConfig(cfg({ moveDate: "2020-01-01" }))).toThrow();
  });

  it("работает для дат 2027+ (алгоритмические праздники)", () => {
    // 2027-03-26 — Karfreitag 2027 (алгоритм Бутчера)
    expect(() => validateConfig(cfg({ moveDate: "2027-03-26" }))).toThrow();
    // 2028-04-14 — Karfreitag 2028
    expect(() => validateConfig(cfg({ moveDate: "2028-04-14" }))).toThrow();
    // Обычный день 2028 — валиден
    expect(() => validateConfig(cfg({ moveDate: "2028-06-15" }))).not.toThrow();
  });
});

describe("calculateQuote", () => {
  it("базовая линия: base + crew + distance, без скидок", () => {
    const q = calculateQuote(cfg(), T);
    // base B = 54000; crew = ceil(20*0.25*2)*... = crewHoursLoad*2900; distance = (100-31 beyond free? нет: free 31, 100-31=69)*80*? per_km — 69 км × 80 центов
    const base = q.lines.find((l) => l.key === "base");
    const crew = q.lines.find((l) => l.key === "crew");
    const dist = q.lines.find((l) => l.key === "distance");
    expect(base?.amount).toBe(54000);
    expect(crew).toBeDefined();
    expect(dist).toBeDefined();
    // Скидки/мультипликаторы не применяются во вторник без опций
    expect(q.multiplierPct).toBe(0);
    expect(q.discount).toBe(0);
    // НДС 19%
    expect(q.vat).toBe(Math.round((q.net * 19) / 100));
    expect(q.gross).toBe(q.net + q.vat);
    // Аванс 30%
    expect(q.deposit).toBe(Math.round((q.gross * 30) / 100));
    expect(q.remainder).toBe(q.gross - q.deposit);
  });

  it("все суммы — целые центы", () => {
    const q = calculateQuote(cfg({ volumeM3: 7, distanceKm: 213, boxes: 33, packHours: 3 }), T);
    for (const l of q.lines) expect(Number.isInteger(l.amount)).toBe(true);
    expect(Number.isInteger(q.net)).toBe(true);
    expect(Number.isInteger(q.vat)).toBe(true);
    expect(Number.isInteger(q.gross)).toBe(true);
    expect(Number.isInteger(q.deposit)).toBe(true);
  });

  it("суббота добавляет weekendPct (праздник отклоняется validateConfig)", () => {
    const weekday = calculateQuote(cfg(), T);
    const saturday = calculateQuote(cfg({ moveDate: "2026-11-07" }), T); // суббота
    expect(saturday.multiplierPct).toBe(T.weekendPct);
    expect(saturday.net).toBeGreaterThan(weekday.net);
    // Праздничная дата в calculateQuote не попасть — validateConfig бросает:
    expect(() => calculateQuote(cfg({ moveDate: "2026-12-25" }), T)).toThrow();
  });

  it("express добавляет expressPct поверх выходного", () => {
    const saturday = calculateQuote(cfg({ moveDate: "2026-11-07" }), T);
    const expressSaturday = calculateQuote(cfg({ moveDate: "2026-11-07", express: true }), T);
    expect(expressSaturday.multiplierPct).toBe(T.weekendPct + T.expressPct);
    expect(expressSaturday.net).toBeGreaterThan(saturday.net);
  });

  it("sharedLoad даёт скидку до мультипликатора", () => {
    const q = calculateQuote(cfg({ sharedLoad: true }), T);
    expect(q.discount).toBe(Math.round((q.subtotal * T.sharedLoadPct) / 100));
  });

  it("сезонный и загрузочный коэффициенты суммируются с остальными", () => {
    const T2: Tariffs = { ...structuredClone(T), seasonPct: 5, loadPct: 3 };
    const q = calculateQuote(cfg(), T2);
    expect(q.multiplierPct).toBe(8);
  });

  it("лифт: плоская ставка elevatorCents за направление; без лифта — floors × floorCents", () => {
    const noLift = calculateQuote(cfg({ elevatorFrom: false, elevatorTo: false }), T);
    const lift = calculateQuote(cfg({ elevatorFrom: true, elevatorTo: true }), T);
    const noLiftFloors = noLift.lines.filter((l) => l.key === "floorFrom" || l.key === "floorTo");
    const liftFloors = lift.lines.filter((l) => l.key === "floorFrom" || l.key === "floorTo");
    // Без лифта: 1 этаж × 3500 за каждый конец
    for (const l of noLiftFloors) expect(l.amount).toBe(1 * T.floorCents);
    // С лифтом: строки остаются, но по фикс. ставке лифта
    expect(liftFloors).toHaveLength(2);
    for (const l of liftFloors) expect(l.amount).toBe(T.elevatorCents);
  });

  it("extraVolume: объём сверх includedM3 платится отдельно (при classForced)", () => {
    // B: includedM3=20 → 20 м³ бесплатно; доп. объём считается ТОЛЬКО при classForced
    const exact = calculateQuote(cfg({ volumeM3: 20, classForced: true }), T);
    const extra = calculateQuote(cfg({ volumeM3: 25, classForced: true }), T);
    expect(extra.lines.find((l) => l.key === "extraVolume")).toBeDefined();
    // extra = 5 м³ × 1490
    expect(extra.lines.find((l) => l.key === "extraVolume")?.amount).toBe(5 * T.extraM3Cents);
    expect(extra.gross).toBeGreaterThan(exact.gross);
    // Без classForced доп. объём не начисляется
    const notForced = calculateQuote(cfg({ volumeM3: 25 }), T);
    expect(notForced.lines.find((l) => l.key === "extraVolume")).toBeUndefined();
  });

  it("needsSecondDriver: длинная смена", () => {
    const short = calculateQuote(cfg({ volumeM3: 10, distanceKm: 50 }), T);
    // Длинный переезд: много объёма + этажи без лифта + большой километр
    const long = calculateQuote(
      cfg({ volumeM3: 40, distanceKm: 800, floorsFrom: 4, floorsTo: 4 }),
      T,
    );
    expect(typeof short.needsSecondDriver).toBe("boolean");
    expect(long.needsSecondDriver).toBe(true);
  });

  it("vatEnabled=false убирает НДС", () => {
    const T2: Tariffs = { ...structuredClone(T), vatEnabled: false };
    const q = calculateQuote(cfg(), T2);
    expect(q.vat).toBe(0);
    expect(q.gross).toBe(q.net);
  });
});

describe("loadFactorPct (задача 6)", () => {
  const av = (status: DayStatus, freeSuitable = 2): DayAvailability => ({
    status,
    freeVehicles: 2,
    freeDrivers: 2,
    freeSuitable,
    pendingOrders: 0,
    maxVehicles: 4,
    maxDrivers: 2,
  });

  it("busy → maxPct, partial → половина, free → 0", () => {
    expect(loadFactorPct(av("busy"), 20)).toBe(20);
    expect(loadFactorPct(av("partial"), 20)).toBe(10);
    expect(loadFactorPct(av("free"), 20)).toBe(0);
  });

  it("maxPct <= 0 → всегда 0 (выключено)", () => {
    expect(loadFactorPct(av("busy"), 0)).toBe(0);
    expect(loadFactorPct(av("busy"), -5)).toBe(0);
  });
});

describe("autoLoadPct в расчёте (задача 6)", () => {
  it("multiplierPct учитывает autoLoadPct", () => {
    const base = calculateQuote(cfg(), T);
    const loaded = calculateQuote(cfg({ autoLoadPct: 20 }), T);
    // 20% авто-коэффициента: gross = round(round((subtotal-discount)*(1+20/100)) с НДС)
    expect(loaded.gross).toBeGreaterThan(base.gross);
    const netNoVat = Math.round((base.subtotal - base.discount) * 1.2);
    expect(loaded.net).toBe(netNoVat);
  });

  it("undefined autoLoadPct → идентично базовому расчёту", () => {
    const base = calculateQuote(cfg(), T);
    const noField = calculateQuote(cfg({ autoLoadPct: undefined }), T);
    expect(noField.gross).toBe(base.gross);
  });

  it("autoLoadPct фиксируется в снимке и воспроизводится recalculate", () => {
    const cfgFull = cfg({ autoLoadPct: 15 });
    const quote = calculateQuote(cfgFull, T);
    const snap = makeSnapshot(cfgFull, structuredClone(T));
    expect(snap.config.autoLoadPct).toBe(15);
    expect(recalculate(snap).gross).toBe(quote.gross);
  });
});

describe("snapshot roundtrip", () => {
  it("makeSnapshot → recalculate воспроизводит ту же цену", () => {
    const cfgFull = cfg({ volumeM3: 18, distanceKm: 250, boxes: 20, packHours: 2 });
    const quote = calculateQuote(cfgFull, T);
    const snap = makeSnapshot(cfgFull, { ...structuredClone(T), quoteValidDays: 14 });
    const again = recalculate(snap);
    expect(again.gross).toBe(quote.gross);
    expect(again.lines).toEqual(quote.lines);
  });

  it("recalculate учитывает тарифы из снимка (мутируем snap.tariffs)", () => {
    const cfgFull = cfg();
    const quote = calculateQuote(cfgFull, T);
    const snap = makeSnapshot(cfgFull, T);
    // D4.10: recalculate берёт тарифы только из снимка — мутируем снимок
    snap.tariffs.classes.B.baseCents = 60000;
    const again = recalculate(snap);
    expect(again.gross).toBeGreaterThan(quote.gross);
  });

  it("quoteValidUntil = дата (YYYY-MM-DD) now + N дней", () => {
    const snap = makeSnapshot(cfg(), { ...structuredClone(T), quoteValidDays: 14 });
    // quoteValidUntil — date-only строка
    expect(snap.quoteValidUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const expected = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    expect(snap.quoteValidUntil).toBe(expected);
  });
});

describe("минимальная стоимость (floor)", () => {
  // Примечание: при дефолтных тарифах floor (35 €) недостижим — минимальный
  // base класса A (340 €) всегда выше. Механику floor проверяем изменённым тарифом:
  // админ может поднять floor как экономический фильтр мусорных заявок (D8).
  const HIGH_FLOOR = { ...T, floorCents: 100000 }; // 1000 €

  it("сумма строк ниже floorCents → расчёт поднимается до floor", () => {
    const tiny = cfg({ volumeM3: 1, distanceKm: 3, floorsFrom: 0, floorsTo: 0 });
    const q = calculateQuote(tiny, HIGH_FLOOR);
    expect(q.subtotal).toBe(100000); // floor применяется
    expect(q.net).toBe(100000); // без скидок/мультипликаторов
    expect(q.gross).toBe(119000); // + НДС 19%
  });

  it("обычный расчёт floor не трогает", () => {
    const q = calculateQuote(cfg(), T);
    expect(q.subtotal).toBeGreaterThan(T.floorCents);
  });

  it("recalculate(snap) воспроизводит floor-расчёт", () => {
    const tiny = cfg({ volumeM3: 1, distanceKm: 3, floorsFrom: 0, floorsTo: 0 });
    const snap = makeSnapshot(tiny, HIGH_FLOOR);
    expect(recalculate(snap).gross).toBe(calculateQuote(tiny, HIGH_FLOOR).gross);
  });
});

describe("возврат на базу (returnKm, @1641)", () => {
  it("без returnKm строки Rückfahrt нет", () => {
    const q = calculateQuote(cfg(), T);
    expect(q.lines.find((l) => l.key === "return")).toBeUndefined();
  });

  it("returnKm добавляет строку Rückfahrt = км × perKmCents (без freeKm)", () => {
    const q = calculateQuote(cfg({ returnKm: 50 }), T);
    const line = q.lines.find((l) => l.key === "return");
    expect(line).toBeDefined();
    expect(line?.amount).toBe(50 * T.perKmCents); // perKmCents = 80 → 4000 центов
    expect(line?.label).toBe("Rückfahrt (Leerfahrt zur Basis)");
    // subtotal включает возврат
    const withoutReturn = calculateQuote(cfg(), T);
    expect(q.subtotal).toBe(withoutReturn.subtotal + 4000);
  });

  it("снимок фиксирует returnKm, recalculate воспроизводит", () => {
    const cfgFull = cfg({ returnKm: 120 });
    const quote = calculateQuote(cfgFull, T);
    const snap = makeSnapshot(cfgFull, T);
    expect(snap.config.returnKm).toBe(120);
    expect(recalculate(snap).gross).toBe(quote.gross);
  });
});
