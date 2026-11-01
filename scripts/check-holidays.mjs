// Проверка алгоритма праздников: сверка с известными датами Пасхи и полными списками 2026/2027.
import { easterSunday, germanHolidays, isHoliday } from "../src/lib/holidays.ts";

// Известные даты католической Пасхи: 2026: 05.04, 2027: 28.03, 2028: 16.04, 2029: 01.04, 2030: 21.04, 2031: 13.04, 2032: 28.03, 2033: 17.04, 2034: 09.04, 2035: 25.03
const known = { 2026: "2026-04-05", 2027: "2027-03-28", 2028: "2028-04-16", 2029: "2029-04-01", 2030: "2030-04-21", 2031: "2031-04-13", 2032: "2032-03-28", 2033: "2033-04-17", 2034: "2034-04-09", 2035: "2035-03-25" };
let fail = 0;
for (const [y, iso] of Object.entries(known)) {
  const got = easterSunday(Number(y));
  if (got !== iso) { console.log(`EASTER MISMATCH ${y}: got ${got}, want ${iso}`); fail++; }
}
// Karfreitag 2026 = 03.04 (в старом списке был), Ostermontag 2026 = 06.04
const h2026 = germanHolidays(2026);
console.log("2026:", h2026.join(" "));
if (!h2026.includes("2026-04-03") || !h2026.includes("2026-04-06")) { console.log("2026 Karfreitag/Ostermontag wrong"); fail++; }
// Christi Himmelfahrt 2027 = 06.05 (в старом списке был), Pfingstmontag 2027 = 17.05
const h2027 = germanHolidays(2027);
console.log("2027:", h2027.join(" "));
if (!h2027.includes("2027-05-06") || !h2027.includes("2027-05-17")) { console.log("2027 Himmelfahrt/Pfingstmontag wrong"); fail++; }
// 2028+ работает
console.log("2028:", germanHolidays(2028).join(" "));
if (!isHoliday("2028-04-14")) { console.log("2028 Karfreitag missing"); fail++; } // Пасха 16.04, Karfreitag = 14.04
if (isHoliday("2028-04-15")) { console.log("2028-04-15 must NOT be holiday"); fail++; }
console.log(fail === 0 ? "ALL OK" : `FAILURES: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
