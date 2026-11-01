// Операционная логика Э4 (D5): матрица переходов, назначения, конфликты.

import {
  calculateQuote, recalculate,
  type QuoteSnapshot, type VehicleClass,
} from "./pricing";
import { getDb, getTariffs, type DB } from "./db";
import type { InValue } from "@libsql/client";

export type OrderStatus = "new" | "confirmed" | "assigned" | "enroute" | "acceptance" | "closed" | "cancelled";
export type Role = "kunde" | "logist" | "driver" | "finance" | "admin";

/** D5.1: матрица прав переходов — одна константа, requireRole на каждом экшене. */
export const ALLOWED_TRANSITIONS: Record<
  OrderStatus,
  Array<{ to: OrderStatus; roles: Role[] }>
> = {
  new:        [{ to: "confirmed", roles: ["logist", "admin"] }, { to: "cancelled", roles: ["kunde", "logist", "admin"] }],
  confirmed:  [{ to: "assigned", roles: ["logist", "admin"] }, { to: "cancelled", roles: ["kunde", "logist", "admin"] }],
  assigned:   [{ to: "enroute", roles: ["driver", "admin"] }, { to: "cancelled", roles: ["logist", "admin"] }],
  enroute:    [{ to: "acceptance", roles: ["kunde", "admin"] }, { to: "closed", roles: ["logist", "admin"] }], // отмены после выезда нет (D5.1); приёмку подтверждает клиент; force-close зависшей приёмки (D7.6)
  acceptance: [{ to: "closed", roles: ["logist", "admin"] }],
  closed:     [],
  cancelled:  [],
};

export function canTransition(from: OrderStatus, to: OrderStatus, role: Role): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).some((t) => t.to === to && t.roles.includes(role));
}

/** Ранг класса A<B<C (D5.6): машина не ниже оплаченного класса. */
const CLASS_RANK: Record<VehicleClass, number> = { A: 1, B: 2, C: 3 };

export interface AssignInput {
  orderId: number;
  vehicleId: number;
  driverId: number;
  codriverId?: number | null;
}

export interface AssignResult {
  ok: boolean;
  error?: "auth" | "role" | "order" | "state" | "vehicle" | "busy" | "codriver" | "date" | "drift";
  message?: string;
}

/** Проверка тариф-дрифта snapshot vs текущие тарифы (D5.7). Разошлось — назначение/подтверждение запрещено. */
export function tariffDrift(
  snap: QuoteSnapshot,
  referenceGross: number,
  currentTariffs?: import("./pricing").Tariffs,
): boolean {
  try {
    // D8.7/Э7-критерий: дрифт = расхождение с ТЕКУЩИМИ тарифами (не сними-копией).
    // recalculate(snap) всегда совпадает с сохранённым gross — он читает тарифы из снимка (D4.10).
    const gross = currentTariffs
      ? calculateQuote(snap.config, currentTariffs).gross
      : recalculate(snap).gross;
    return gross !== referenceGross;
  } catch {
    return true; // неизвестная версия снимка = дрифт
  }
}

/**
 * Назначение машины и бригады (D5.3–D5.8): одна транзакция (libsql batch),
 * проверки до записи; конфликт-проверка внутри batch через условный порядок.
 */
export async function assignOrder(
  db: import("./db").DB,
  input: AssignInput,
  user: { id: number; role: Role },
): Promise<AssignResult> {
  await getDb();
  const orderRes = await db.execute({
    sql: "SELECT id, ref, status, vehicle_class, snapshot, volume_m3, move_date, gross_cents FROM orders WHERE id = ?",
    args: [input.orderId],
  });
  const order = orderRes.rows[0] as unknown as
    { id: number; ref: string; status: OrderStatus; vehicle_class: VehicleClass; snapshot: string; volume_m3: number; move_date: string; gross_cents: number } | undefined;
  if (!order) return { ok: false, error: "order", message: "Заявка не найдена." };
  if (order.status !== "confirmed") {
    return { ok: false, error: "state", message: `Назначение возможно только из статуса «Подтверждена» (сейчас: ${order.status}).` };
  }
  if (!canTransition(order.status, "assigned", user.role)) {
    return { ok: false, error: "role", message: "Недостаточно прав." };
  }

  const snap = JSON.parse(String(order.snapshot)) as QuoteSnapshot;

  // Тариф-дрифт (D5.7): разошлось с ТЕКУЩИМИ тарифами — запрещаем.
  if (tariffDrift(snap, Number(order.gross_cents), await getTariffs(db))) {
    return { ok: false, error: "drift", message: "Тарифы изменились после расчёта — пересчёт требуется, назначение заблокировано." };
  }

  // Машина: активна, класс не ниже оплаченного (D5.6), вместимость (D5.6)
  const vRes = await db.execute({
    sql: "SELECT id, plate, label, class, capacity_m3, active FROM vehicles WHERE id = ?",
    args: [input.vehicleId],
  });
  const vehicle = vRes.rows[0] as unknown as { id: number; plate: string; label: string; class: VehicleClass; capacity_m3: number; active: number } | undefined;
  if (!vehicle || !Number(vehicle.active)) return { ok: false, error: "vehicle", message: "Машина не найдена или неактивна." };
  if (CLASS_RANK[vehicle.class] < CLASS_RANK[order.vehicle_class]) {
    return { ok: false, error: "vehicle", message: `Клиент оплатил класс ${order.vehicle_class}; машина класса ${vehicle.class} ниже оплаченного.` };
  }
  if (Number(vehicle.capacity_m3) < Number(order.volume_m3)) {
    return { ok: false, error: "vehicle", message: `Вместимость машины ${vehicle.capacity_m3} м³ меньше объёма заказа ${order.volume_m3} м³.` };
  }

  // Водители: роль driver, активны, различны
  const dRes = await db.execute({
    sql: "SELECT id, active FROM users WHERE id = ? AND role = 'driver' AND active = 1",
    args: [input.driverId],
  });
  if (!dRes.rows[0]) return { ok: false, error: "vehicle", message: "Водитель не найден или неактивен." };
  if (input.codriverId && input.codriverId === input.driverId) {
    return { ok: false, error: "codriver", message: "Второй водитель совпадает с первым." };
  }
  if (input.codriverId) {
    const co = await db.execute({
      sql: "SELECT id, active FROM users WHERE id = ? AND role = 'driver' AND active = 1",
      args: [input.codriverId],
    });
    if (!co.rows[0]) return { ok: false, error: "codriver", message: "Второй водитель не найден или неактивен." };
  }

  // needsSecondDriver → кодрайвер обязателен (D5.8, §9 ArbZG)
  const needsSecond = (() => { try { return recalculate(snap).needsSecondDriver; } catch { return false; } })();
  if (needsSecond && !input.codriverId) {
    return { ok: false, error: "codriver", message: "Смена >10 ч — требуется второй водитель." };
  }

  // Дата: не в прошлом (D5.9)
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (String(order.move_date) < todayIso) {
    return { ok: false, error: "date", message: "Дата переезда уже в прошлом." };
  }

  // Транзакция (D5.3/D5.4): batch с cleanup → INSERT → UPDATE.
  // Конфликт-проверка: приоритет уникального PK(resource_type, resource_id, move_date) —
  // INSERT при занятости бросит ошибку UNQEF, ловим ниже.
  const now = Math.floor(Date.now() / 1000);
  const stmts = [
    { sql: "DELETE FROM assignments WHERE order_id = ?", args: [order.id] },
    { sql: "DELETE FROM trips WHERE order_id = ?", args: [order.id] },
    { sql: "INSERT INTO assignments (resource_type, resource_id, move_date, order_id) VALUES ('vehicle', ?, ?, ?)", args: [vehicle.id, order.move_date, order.id] },
    { sql: "INSERT INTO assignments (resource_type, resource_id, move_date, order_id) VALUES ('driver', ?, ?, ?)", args: [input.driverId, order.move_date, order.id] },
    ...(input.codriverId
      ? [{ sql: "INSERT INTO assignments (resource_type, resource_id, move_date, order_id) VALUES ('driver', ?, ?, ?)", args: [input.codriverId, order.move_date, order.id] as InValue[] }]
      : []),
    { sql: "INSERT INTO trips (order_id, vehicle_id, driver_id, codriver_id, move_date, seq) VALUES (?, ?, ?, ?, ?, 1)", args: [order.id, vehicle.id, input.driverId, input.codriverId ?? null, order.move_date] },
    { sql: "UPDATE orders SET status = 'assigned', updated_at = ? WHERE id = ?", args: [now, order.id] },
  ];
  try {
    await db.batch(stmts, "write");
    return { ok: true };
  } catch (e) {
    // PK(resource_type, resource_id, move_date) — последняя линия защиты от гонки (D5.4)
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE") || msg.includes("UNQEF") || msg.includes("PRIMARY")) {
      return { ok: false, error: "busy", message: `Ресурс уже занят на ${order.move_date}.` };
    }
    throw e;
  }
}

