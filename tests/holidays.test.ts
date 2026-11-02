import { describe, it, expect } from "vitest";
import { germanHolidays, isHoliday } from "../src/lib/holidays";

describe("germanHolidays", () => {
  // Пасха сверена с официальным календарём
  const cases: Array<[number, string]> = [
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2028, "2028-04-16"],
    [2029, "2029-04-01"],
    [2030, "2030-04-21"],
    [2035, "2035-03-25"],
  ];

  for (const [year, easter] of cases) {
    it(`Ostermontag ${year} = Пасха + 1 (Пасха ${easter})`, () => {
      const h = germanHolidays(year);
      // Ostermontag = easter + 1 (TZ-независимо через Date.UTC)
      const [y, m, d] = easter.split("-").map(Number);
      const monday = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      expect(h).toContain(monday);
    });
  }

  it("фиксированные даты присутствуют", () => {
    const h2026 = germanHolidays(2026);
    for (const d of ["2026-01-01", "2026-05-01", "2026-10-03", "2026-12-25", "2026-12-26"]) {
      expect(h2026).toContain(d);
    }
  });

  it("Karfreitag 2027 = 26.03 (регрессия: в старом статическом списке была ошибка 28.03)", () => {
    expect(germanHolidays(2027)).toContain("2027-03-26");
    expect(germanHolidays(2027)).not.toContain("2027-03-28");
  });

  it("9 праздников в году", () => {
    expect(germanHolidays(2028)).toHaveLength(9);
  });

  it("возвращает одинаковый результат повторно (кэш)", () => {
    expect(germanHolidays(2029)).toEqual(germanHolidays(2029));
  });
});

describe("isHoliday", () => {
  it("распознаёт праздники в 2026–2028", () => {
    expect(isHoliday("2026-12-25")).toBe(true);
    expect(isHoliday("2027-03-26")).toBe(true);
    expect(isHoliday("2028-04-14")).toBe(true); // Karfreitag 2028
  });

  it("обычные дни — не праздники", () => {
    expect(isHoliday("2026-11-03")).toBe(false);
    expect(isHoliday("2027-06-15")).toBe(false);
  });
});
