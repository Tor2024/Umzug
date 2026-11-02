// Расчёт себестоимости минимального заказа: что должно стоить, чтобы покрыть
// зарплаты экипажа, налоги, амортизацию и дать прибыль.
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) { console.error("Need TURSO env"); process.exit(1); }
const db = createClient({ url, authToken: token });

const cfg = await db.execute("SELECT key, value FROM config WHERE key LIKE 'pricing%'");
const C = {};
for (const r of cfg.rows) C[r.key] = Number(r.value);
const vc = await db.execute("SELECT class, base_cents, capacity_m3 FROM vehicle_classes WHERE active=1");
const classes = vc.rows.map(r => ({ code: r.class, base: Number(r.base_cents), cap: Number(r.capacity_m3) }));

// Текущие тарифные параметры (центы):
const t = {
  crewHourly: C["pricing.crew_hourly_cents"],      // ставка одного грузчика, €/ч
  crewCount: C["pricing.crew_count"],              // человек в экипаже (без водителя? — считаем всех)
  hoursPerM3: C["pricing.hours_per_m3"] / 100,     // часов погрузки на м³
  minCrewHours: C["pricing.min_crew_hours"],       // мин. часы экипажа
  perKm: C["pricing.per_km_cents"],                // €-центы за км
  freeKm: C["pricing.free_km"],
  vat: C["pricing.vat_pct"],
  floor: C["pricing.floor_cents"],
};

// ── РЕАЛЬНАЯ себестоимость (рыночные данные Германии, 2026, брутто-зарплаты) ──
// Грузчик: ~16 €/ч брутто-зарплата; с социальными отчислениями работодателя
// (~21%: пенсия, медстраховка, налог на зарплатный фонд) ≈ 19,4 €/чCost.
// Водитель C/CE: ~22 €/ч зарплата → ~26,6 €/ч cost.
const crewCostPerHour = 19.4;   // €/ч себестоимость одного грузчика
const driverCostPerHour = 26.6; // €/ч себестоимость водителя

// Транспорт (LKW 7,5 т, класс B):
//  - амортизация: б/у ~35 000 €, 5 лет, 20 т.км/год → ~0,35 €/км
//  - дизель 22 л/100км × 1,65 €/л = 0,36 €/км
//  - страховка+налоги+техосмотр: ~3 500 €/год, 20 000 км/год → 0,18 €/км
//  - ТО/ремонт/шины: ~0,15 €/км
// Итого транспорт ≈ 1,04 €/км
const vehicleCostPerKm = 1.04;

// Накладные (офис, диспетчер, сайт, телефон, бухгалтерия): ~8-12% от выручки → берём 10%
const OVERHEAD_PCT = 10;
// НДС не является доходом (перечисляется в Finanzamt), работаем с netto.
// Налог на прибыль GmbH (~15% + солидарный 5,5% ≈ 15,8%) + trade tax (~14%) ≈ 30% combined.
// Это налог с ПРИБЫЛИ, не с выручки — сначала считаем маржу.

// ── Минимальный типовой заказ: класс A (Transporter 3,5 т), 1 переезд ──
// Работа: мин. 2 часа экипажа (min_crew_hours) + водитель те же 2 часа
// Расстояние: средний городской переезд в Берлине ~30 км в одну сторону → 60 км.
// Экипаж: 2 грузчика + 1 водитель (класс A — маленький transporter).

console.log("=== ТЕКУЩИЕ ТАРИФЫ (что платит клиент) ===");
console.log(`Ставка грузчика: ${(t.crewHourly/100).toFixed(2)} €/ч × ${t.crewCount} чел`);
console.log(`Мин. часы экипажа: ${t.minCrewHours} ч`);
console.log(`Дорога: ${(t.perKm/100).toFixed(2)} €/км после ${t.freeKm} бесплатных`);
console.log(`Floor: ${(t.floor/100).toFixed(2)} € (недостижим, base A=${(classes[0].base/100).toFixed(0)} €)`);
console.log(`Base A: ${(classes[0].base/100).toFixed(2)} €, Base B: ${(classes[1].base/100).toFixed(2)} €\n`);

// Минимальный заказ по ТЕКУЩЕЙ модели: класс A, 10 м³ (included A), 60 км
const hoursWorked = Math.max(t.minCrewHours, 10 * t.hoursPerM3); // 10 м³ × 0.25 = 2.5ч → min 2ч
const km = 60;

// Клиент платит: base + crew + distance (в ЦЕНТАХ)
const clientCrew = t.crewHourly * t.crewCount * hoursWorked;
const clientDist = Math.max(0, km - t.freeKm) * t.perKm;
const clientNet = classes[0].base + clientCrew + clientDist;

// Себестоимость: 2 грузчика + водитель × те же часы + транспорт (в ЦЕНТАХ)
const costCrew = Math.round((2 * crewCostPerHour + driverCostPerHour) * hoursWorked * 100);
const costVehicle = Math.round(km * vehicleCostPerKm * 100);
const costNet = costCrew + costVehicle;

// Налоги: накладные 10% от выручки, затем прибыль до налога, налог ~30% прибыли
const overhead = clientNet * OVERHEAD_PCT / 100;
const profitBeforeTax = clientNet - costNet - overhead;
const corpTax = profitBeforeTax > 0 ? profitBeforeTax * 0.30 : 0;
const profitAfterTax = profitBeforeTax - corpTax;

console.log("=== МИНИМАЛЬНЫЙ ЗАКАЗ: класс A (Transporter), 10 м³, 60 км, 2.5ч ===");
console.log(`Клиент платит (netto): ${(clientNet/100).toFixed(2)} €`);
console.log(`  base A: 340.00 € + crew: ${(clientCrew/100).toFixed(2)} € + dist: ${(clientDist/100).toFixed(2)} €`);
console.log(`Себестоимость: ${(costNet/100).toFixed(2)} €`);
console.log(`  экипаж (2 грузчика+водитель, ${hoursWorked}ч): ${(costCrew/100).toFixed(2)} €`);
console.log(`  транспорт (60 км × 1.04 €): ${(costVehicle/100).toFixed(2)} €`);
console.log(`Накладные (10%): ${(overhead/100).toFixed(2)} €`);
console.log(`Прибыль до налога: ${(profitBeforeTax/100).toFixed(2)} € (${(profitBeforeTax/clientNet*100).toFixed(1)}%)`);
console.log(`Налог на прибыль (~30%): ${(corpTax/100).toFixed(2)} €`);
console.log(`Прибыль после налога: ${(profitAfterTax/100).toFixed(2)} €\n`);

// ── Каким должен быть МИН. ТАРИФ, чтобы прибыль ≥ 15% после налога? ──
// target: profitAfterTax = 0.15 × clientNet
// profitBeforeTax = clientNet - costNet - 0.10×clientNet
// after tax = 0.7 × (0.90×clientNet - costNet) = 0.15×clientNet
// → 0.63×clientNet - 0.7×costNet = 0.15×clientNet → 0.48×clientNet = 0.7×costNet
// → clientNet_min = 0.7×costNet / 0.48 ≈ 1.458 × costNet
const MIN_MARGIN_MULT = 0.7 / 0.48;
const clientNetMin = costNet * MIN_MARGIN_MULT;

console.log("=== РЕКОМЕНДУЕМЫЙ МИНИМУМ (прибыль 15% после всех налогов) ===");
console.log(`Клиент должен платить (netto): ${(clientNetMin/100).toFixed(2)} €`);
console.log(`  = себестоимость ${(costNet/100).toFixed(2)} € × ${MIN_MARGIN_MULT.toFixed(2)}`);
console.log(`  брутто с НДС 19%: ${((clientNetMin*1.19)/100).toFixed(2)} €\n`);

// ── Класс B (LKW 7,5 т), 20 м³, дальний переезд 300 км, 5ч работы ──
const hoursB = Math.max(t.minCrewHours, 20 * t.hoursPerM3); // 5ч
const kmB = 300;
const costCrewB = Math.round((3 * crewCostPerHour + driverCostPerHour) * hoursB * 100);
const costVehicleB = Math.round(kmB * vehicleCostPerKm * 100);
const costB = costCrewB + costVehicleB;
const clientNetB = classes[1].base + t.crewHourly*3*hoursB + Math.max(0, kmB - t.freeKm)*t.perKm;
const overheadB = clientNetB * 0.10;
const pbtB = clientNetB - costB - overheadB;
const patB = pbtB * 0.7;

console.log("=== СРАВНЕНИЕ: класс B (LKW 7,5т), 20 м³, 300 км, 5ч ===");
console.log(`Клиент платит (netto): ${(clientNetB/100).toFixed(2)} €`);
console.log(`Себестоимость: ${(costB/100).toFixed(2)} € (экипаж ${(costCrewB/100).toFixed(2)} + транспорт ${(costVehicleB/100).toFixed(2)})`);
console.log(`Прибыль до налога: ${(pbtB/100).toFixed(2)} € (${(pbtB/clientNetB*100).toFixed(1)}%)`);
console.log(`После налога: ${(patB/100).toFixed(2)} € (${(patB/clientNetB*100).toFixed(1)}%)`);
console.log(`Рекоменд. минимум для 15%: ${((costB*MIN_MARGIN_MULT)/100).toFixed(2)} € netto`);
