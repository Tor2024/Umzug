import type { DB } from "./db";
import { CLASS_RANK } from "./availability";
import type { VehicleClass } from "./pricing";

/**
 * Умный подбор машины (требование @1480@):
 * у каждой машины есть current_location (после рейса — город выгрузки),
 * считаем холостой пробег подачи (локация → адрес забора заказа)
 * и ранжируем свободные машины подходящего класса.
 */

export type CandidateVehicle = {
  id: number;
  plate: string;
  label: string;
  vehicleClass: VehicleClass;
  capacityM3: number;
  currentLocation: string;
  /** км холостого пробега подачи (null — геокодирование не удалось) */
  approachKm: number | null;
  /** минуты подачи */
  approachMin: number | null;
  /** внутренняя себестоимость подачи, центы (km × costPerKm); null если approachKm null */
  approachCostCents: number | null;
  /** скоринг: меньше — лучше; null-ки в конец */
  score: number;
  optimal: boolean;
};

/** Внутренняя себестоимость холостого км (см. scripts/min-order-economics.mjs): ~1.04 €/км */
const APPROACH_COST_PER_KM_CENTS = 104;

/** Кандидаты: свободные машины на дату, класс ≥ заказанного. */
export async function candidateVehicles(
  db: DB,
  orderId: number,
  moveDate: string,
  orderFromText: string,
): Promise<CandidateVehicle[]> {
  const res = await db.execute(`
    SELECT v.id, v.plate, v.label, v.class, v.capacity_m3, v.current_location
    FROM vehicles v
    WHERE v.active = 1
      AND v.id NOT IN (
        SELECT resource_id FROM assignments
        WHERE resource_type = 'vehicle' AND move_date = ?
      )
    ORDER BY v.id
  `, [moveDate]);
  const vehicles = res.rows as unknown as
    Array<{ id: number; plate: string; label: string; class: VehicleClass; capacity_m3: number; current_location: string }>;

  // Класс заказанного: из orders
  const ord = await db.execute({ sql: "SELECT vehicle_class, volume_m3 FROM orders WHERE id = ?", args: [orderId] });
  const order = ord.rows[0] as unknown as { vehicle_class: VehicleClass; volume_m3: number } | undefined;
  if (!order) return [];

  // Фильтр: класс не ниже оплаченного и вместимость достаточна
  const eligible = vehicles.filter(
    (v) => CLASS_RANK[v.class] >= CLASS_RANK[order.vehicle_class] && Number(v.capacity_m3) >= Number(order.volume_m3),
  );

  // Холостой пробег подачи для каждого кандидата (последовательно — OSRM demo-сервер, без пачки)
  const geo = await import("./geo");
  const withApproach: Array<Omit<CandidateVehicle, "approachKm" | "approachMin" | "approachCostCents" | "score" | "optimal"> & { approach: { km: number; min: number } | null }> = [];
  for (const v of eligible) {
    let approach: { km: number; min: number } | null = null;
    if (v.current_location) {
      try {
        const r = await geo.resolveRoute(v.current_location, orderFromText, "");
        if (r) approach = { km: r.km, min: r.minutes ?? Math.round(r.km * 0.8) };
      } catch { approach = null; }
    }
    withApproach.push({
      id: v.id,
      plate: v.plate,
      label: v.label,
      vehicleClass: v.class,
      capacityM3: Number(v.capacity_m3),
      currentLocation: v.current_location,
      approach,
    });
  }
  return rankCandidates(withApproach);
}


/**
 * Холостой пробег для одной машины: current_location → order.from_text.
 * Возвращает null если геокодирование/маршрут не удались.
 */
export async function approachForVehicle(
  fromText: string,
  toOrderFrom: string,
): Promise<{ km: number; min: number } | null> {
  const geo = await import("./geo");
  // resolveRoute сам геокодирует и строит маршрут; apiKey передаём пустым (OSRM)
  const r = await geo.resolveRoute(fromText, toOrderFrom, "");
  if (!r) return null;
  return { km: r.km, min: r.minutes ?? Math.round(r.km * 0.8) };
}

/** Ранжирование: подход с километражем, оптимальный = минимум км. */
export function rankCandidates(
  candidates: Array<Omit<CandidateVehicle, "approachKm" | "approachMin" | "approachCostCents" | "score" | "optimal"> & {
    approach: { km: number; min: number } | null;
  }>,
): CandidateVehicle[] {
  const withScore = candidates.map((c) => ({
    ...c,
    approachKm: c.approach?.km ?? null,
    approachMin: c.approach?.min ?? null,
    approachCostCents: c.approach ? Math.round(c.approach.km * APPROACH_COST_PER_KM_CENTS) : null,
    score: c.approach?.km ?? Number.MAX_SAFE_INTEGER,
  }));
  withScore.sort((a, b) => a.score - b.score);
  const best = withScore.find((c) => c.approachKm !== null);
  return withScore.map((c) => ({ ...c, optimal: c === best }));
}
