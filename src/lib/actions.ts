// Серверные действия заказов (Э3). Правила D4:
// - сабмит только для вошедшего kunde (гость → ошибка с редиректом на /login?next=);
// - km сервер пересчитывает сам (D4.1), маршрут не решился → заказ НЕ создаётся (D4.2);
// - снимок = истина цены; контроль recalculate(snap).gross === quote.gross перед INSERT (D4.11);
// - order_lines — проекция quote.lines (D4.9).

"use server";

import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getDb, findSession, deleteSession, getTariffs, classForVolume, audit, sha256, protocolHashString, normalizeConfigValue, writeConfigValue, hashPassword, invalidateUserSessions, CONFIG_SCHEMA, logOrderEvent, saveSnapshotVersion, type DB } from "./db";
import { buildRevisionSnapshot, type OrderForRevision } from "./revision";
import { COOKIE } from "./auth";
import { canTransition, assignOrder, tariffDrift, type AssignResult, type OrderStatus } from "./ops";
import {
  calculateQuote, makeSnapshot, recalculate, validateConfig,
  ValidationError, type MoveConfig, type QuoteSnapshot, type VehicleClass,
} from "./pricing";
import { resolveRoute, validAddress } from "./geo";
import { dayAvailability, loadFactorPct, nearestFreeDate, CLASS_RANK } from "./availability";
import { isValidLatinName } from "./validate";

export interface OrderInput {
  fromText: string;
  toText: string;
  volumeM3: number;
  floorsFrom: number;
  floorsTo: number;
  elevatorFrom: boolean;
  elevatorTo: boolean;
  boxes: number;
  kitchen: boolean;
  furnitureItems: number;
  packHours: number;
  hvzZones: number;
  extraCrew: number;
  moveDate: string; // ISO yyyy-mm-dd
  express: boolean;
  sharedLoad: boolean;
  vehicleClass: VehicleClass; // «авто» → сервер выбирает сам
  classForced: boolean;
}

export interface CreateOrderResult {
  ok: boolean;
  ref?: string;
  error?: string;         // код ошибки для UI
  message?: string;       // человекочитаемо
}

async function currentUser() {
  const db = await getDb();
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  return findSession(db, token);
}

export async function createOrderAction(input: OrderInput): Promise<CreateOrderResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, error: "auth", message: "Войдите, чтобы отправить заявку." };
  if (user.role !== "kunde") {
    return { ok: false, error: "role", message: "Заявку может отправить только клиент." };
  }

  // D11: лимит открытых заявок (спам-защита; критик 1/п.6)
  const openRes = await db.execute({
    sql: "SELECT COUNT(*) AS c FROM orders WHERE client_id = ? AND status = 'new'",
    args: [user.id],
  });
  const openCount = Number((openRes.rows[0] as unknown as { c: number }).c);
  if (openCount >= 3) {
    return { ok: false, error: "limit", message: "У вас уже 3 заявки в обработке. Дождитесь подтверждения или отмените лишние." };
  }

  // Адреса (D4.7)
  const fromText = input.fromText.trim().slice(0, 200);
  const toText = input.toText.trim().slice(0, 200);
  if (!validAddress(fromText) || !validAddress(toText)) {
    return { ok: false, error: "address", message: "Укажите адреса отправления и прибытия (3–200 символов)." };
  }

  // Маршрут: сервер сам, клиентский km игнорируется (D4.1/D4.2)
  const apiKeyRes = await db.execute("SELECT value FROM config WHERE key = 'maps.api_key'");
  const apiKeyRow = apiKeyRes.rows[0] as unknown as { value: string } | undefined;
  const apiKey = apiKeyRow?.value || process.env.GOOGLE_MAPS_API_KEY || undefined;
  const route = await resolveRoute(fromText, toText, apiKey);
  if (!route || route.km <= 0 || route.error) {
    return { ok: false, error: "route", message: route?.error ?? "Маршрут не рассчитан. Заявка не создана." };
  }

  const cfg: MoveConfig = {
    vehicleClass: input.vehicleClass,
    classForced: input.classForced,
    volumeM3: input.volumeM3,
    distanceKm: route.km,
    durationMin: route.minutes,
    floorsFrom: input.floorsFrom,
    floorsTo: input.floorsTo,
    elevatorFrom: input.elevatorFrom,
    elevatorTo: input.elevatorTo,
    boxes: input.boxes,
    kitchen: input.kitchen,
    furnitureItems: input.furnitureItems,
    packHours: input.packHours,
    hvzZones: input.hvzZones,
    extraCrew: input.extraCrew,
    moveDate: input.moveDate,
    express: input.express,
    sharedLoad: input.sharedLoad,
  };

  let quote;
  let snapshot: QuoteSnapshot;
  // D11: доступность дня (вычисляется в расчётном блоке, используется для гварда записи)
  let av: Awaited<ReturnType<typeof dayAvailability>> | null = null;
  try {
    validateConfig(cfg);
    const tariffs = await getTariffs(db);
    if (input.vehicleClass === "A" && !input.classForced) {
      // авто-выбор класса по объёму (класс «A» в UI = «автоматически»)
      cfg.vehicleClass = await classForVolume(db, cfg.volumeM3);
      cfg.classForced = false;
    }
    quote = calculateQuote(cfg, tariffs);
    // Задача 6: предварительный расчёт нужен до dayAvailability, чтобы узнать needsSecond;
    // финальный расчёт — ниже после авто-коэффициента загрузки.
    const preliminary = quote;
    av = await dayAvailability(db, cfg.moveDate, {
      volumeM3: cfg.volumeM3,
      needsSecond: preliminary.needsSecondDriver,
    });
    cfg.autoLoadPct = loadFactorPct(av, tariffs.autoLoadPct);
    quote = calculateQuote(cfg, tariffs);
    snapshot = makeSnapshot(cfg, tariffs);
    // Контроль воспроизводимости (D4.11)
    const re = recalculate(snapshot);
    if (re.gross !== quote.gross) {
      throw new Error("Контроль пересчёта не сошёлся");
    }
  } catch (e) {
    if (e instanceof ValidationError) {
      return { ok: false, error: "validation", message: e.message };
    }
    throw e;
  }

  // Номер заявки: counters (D2). Атомарно: UPDATE ... RETURNING (гонки двух заказов).
  const year = new Date().getFullYear();
  const nextRef = (async (): Promise<string> => {
    await db.execute({
      sql: "INSERT INTO counters (prefix, year, last) VALUES ('MS', ?, 8940) ON CONFLICT(prefix, year) DO NOTHING",
      args: [year],
    });
    const upd = await db.execute({
      sql: "UPDATE counters SET last = last + 1 WHERE prefix = 'MS' AND year = ? RETURNING last",
      args: [year],
    });
    const row = upd.rows[0] as unknown as { last: number };
    return `MS-${year}-${row.last}`;
  })();

  const now = Math.floor(Date.now() / 1000);
  try {
    // D11: проверка ресурсов до записи (single source of truth — availability.ts)
    if (!av) throw new Error("Доступность дня не рассчитана");
    if (av.status === "busy") {
      const nearest = await nearestFreeDate(db, cfg.moveDate, { volumeM3: cfg.volumeM3 });
      return { ok: false, error: "busy", message: `На ${cfg.moveDate} нет свободных машин нужной вместимости или свободных водителей. Ближайшая дата: ${nearest ?? "уточните по телефону"}.` };
    }

    const ref = await nextRef;
    const insOrder = await db.execute({
      sql: `INSERT INTO orders
        (ref, client_id, contact_name, contact_email, status, vehicle_class, snapshot,
         volume_m3, distance_km, move_date, net_cents, vat_cents, gross_cents,
         deposit_cents, remainder_cents, config_version, express, shared_load,
         from_text, to_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      args: [
        ref, user.id, user.name, user.email, cfg.vehicleClass, JSON.stringify(snapshot),
        cfg.volumeM3, route.km, cfg.moveDate,
        quote.net, quote.vat, quote.gross, quote.deposit, quote.remainder,
        cfg.express ? 1 : 0, cfg.sharedLoad ? 1 : 0,
        fromText, toText, now, now,
      ],
    });
    const orderId = Number(insOrder.lastInsertRowid);
    const lineStmts = quote.lines.map((l, i) => ({
      sql: "INSERT INTO order_lines (order_id, idx, kind, key, label, amount, meta) VALUES (?, ?, 'line', ?, ?, ?, ?)",
      args: [orderId, i, l.key, l.label, l.amount, l.meta ? JSON.stringify(l.meta) : "{}"],
    }));
    const routeStmt = {
      sql: "INSERT INTO route (order_id, from_text, to_text, km, minutes, provider, geometry, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [orderId, fromText, toText, route.km, route.minutes, route.provider,
        route.geometry ? JSON.stringify(route.geometry) : null, now] satisfies import("@libsql/client").InValue[],
    };
    await db.batch([...lineStmts, routeStmt], "write");

    await logOrderEvent(db, orderId, user, "order_created", { ref, gross: quote.gross }); // D10: клиентская история
    await saveSnapshotVersion(db, orderId, JSON.stringify(snapshot), quote.gross, user.id); // D10: версия 1 при создании
    await audit(db, user.id, "order_created", "order", ref, `gross=${quote.gross}`);

    // Уведомление клиенту (не блокирует успех)
    try {
      const { sendOrderCreatedEmail } = await import("./email");
      await sendOrderCreatedEmail(user.email, user.name, ref, quote.gross, cfg.moveDate);
    } catch (e) {
      console.error("[email] order_created notify failed:", e instanceof Error ? e.message : e);
    }

    return { ok: true, ref };
  } catch (e) {
    if (e instanceof Error && e.message.includes("нет свободных машин")) {
      return { ok: false, error: "busy", message: e.message };
    }
    throw e;
  }
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  if (token) await deleteSession(await getDb(), token);
  jar.delete(COOKIE);
}

// ---------------------------------------------------------------------------
// Э4 (D5): подтверждение, пересчёт, отмена, назначение
// ---------------------------------------------------------------------------

export interface SimpleResult { ok: boolean; error?: string; message?: string }

/** Логист подтверждает заявку (new→confirmed). Гейт: тариф-дрифт. */
export async function confirmOrderAction(orderId: number): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || (user.role !== "logist" && user.role !== "admin")) {
    return { ok: false, message: "Недостаточно прав." };
  }
  const orderRes = await db.execute({
    sql: "SELECT id, ref, status, snapshot, gross_cents, pending_snapshot FROM orders WHERE id = ?",
    args: [orderId],
  });
  const order = orderRes.rows[0] as unknown as
    { id: number; ref: string; status: string; snapshot: string; gross_cents: number; pending_snapshot: string | null } | undefined;
  if (!order) return { ok: false, message: "Заявка не найдена." };
  if (order.status !== "new") return { ok: false, message: `Подтвердить можно только новую заявку (сейчас: ${order.status}).` };
  if (order.pending_snapshot) return { ok: false, message: "Сначала завершите правку: заявка ждёт подтверждения изменения." }; // D10
  const snap = JSON.parse(order.snapshot) as QuoteSnapshot;
  if (tariffDrift(snap, Number(order.gross_cents))) {
    return { ok: false, message: "Тарифы изменились после расчёта — сначала пересчитайте заявку." };
  }
  // Атомарный переход: WHERE status='new' (гонки двух логистов / двойного клика)
  const confRes = await db.execute({
    sql: "UPDATE orders SET status = 'confirmed', updated_at = ? WHERE id = ? AND status = 'new'",
    args: [Math.floor(Date.now() / 1000), orderId],
  });
  if (confRes.rowsAffected === 0) return { ok: false, message: "Заявка уже обработана другим сотрудником." };
  await logOrderEvent(db, orderId, user, "status_changed", { from: order.status, to: "confirmed" }); // D10
  await audit(db, user.id, "order_confirmed", "order", order.ref, "");

  // Уведомление клиенту (не блокирует успех)
  try {
    const contactRes = await db.execute({
      sql: "SELECT contact_email, contact_name FROM orders WHERE id = ?",
      args: [orderId],
    });
    const contact = contactRes.rows[0] as unknown as { contact_email: string; contact_name: string } | undefined;
    if (contact?.contact_email) {
      const { sendOrderConfirmedEmail } = await import("./email");
      await sendOrderConfirmedEmail(contact.contact_email, contact.contact_name, order.ref, Number(order.gross_cents), snapQuoteDeposit(order.snapshot));
    }
  } catch (e) {
    console.error("[email] order_confirmed notify failed:", e instanceof Error ? e.message : e);
  }

  return { ok: true };
}

/** Аванс из снимка (для писем). */
function snapQuoteDeposit(snapshotJson: string): number {
  try {
    const snap = JSON.parse(snapshotJson) as { quote?: { deposit?: number } };
    return snap.quote?.deposit ?? 0;
  } catch {
    return 0;
  }
}

/** Пересчёт заявки по текущим тарифам: только для new (после confirmed пересчёт запрещён, D5.7). */
export async function recalcOrderAction(orderId: number): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || (user.role !== "logist" && user.role !== "admin")) {
    return { ok: false, message: "Недостаточно прав." };
  }
  const orderRes = await db.execute({
    sql: "SELECT id, ref, status, snapshot, vehicle_class FROM orders WHERE id = ?",
    args: [orderId],
  });
  const order = orderRes.rows[0] as unknown as
    { id: number; ref: string; status: string; snapshot: string; vehicle_class: VehicleClass } | undefined;
  if (!order) return { ok: false, message: "Заявка не найдена." };
  if (order.status !== "new") {
    return { ok: false, message: "Пересчёт возможен только до подтверждения заявки." };
  }
  const snap = JSON.parse(order.snapshot) as QuoteSnapshot;
  const tariffs = await getTariffs(db);
  let quote;
  let newSnap: QuoteSnapshot;
  try {
    validateConfig(snap.config);
    quote = calculateQuote(snap.config, tariffs);
    newSnap = makeSnapshot(snap.config, tariffs);
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, message: e.message };
    throw e;
  }
  const now = Math.floor(Date.now() / 1000);
  await db.execute({
    sql: "UPDATE orders SET snapshot = ?, net_cents = ?, vat_cents = ?, gross_cents = ?, deposit_cents = ?, remainder_cents = ?, updated_at = ? WHERE id = ?",
    args: [JSON.stringify(newSnap), quote.net, quote.vat, quote.gross, quote.deposit, quote.remainder, now, orderId],
  });
  const lineStmts = [
    { sql: "DELETE FROM order_lines WHERE order_id = ?", args: [orderId] },
    ...quote.lines.map((l, i) => ({
      sql: "INSERT INTO order_lines (order_id, idx, kind, key, label, amount, meta) VALUES (?, ?, 'line', ?, ?, ?, ?)",
      args: [orderId, i, l.key, l.label, l.amount, l.meta ? JSON.stringify(l.meta) : "{}"],
    })),
  ];
  await db.batch(lineStmts, "write");
  await audit(db, user.id, "order_recalculated", "order", order.ref, `gross=${quote.gross}`);
  return { ok: true };
}

/** Отмена (D5.1/D5.2): kunde — new/confirmed; logist/admin — new/confirmed/assigned. Cleanup assignments+trips. */
export async function cancelOrderAction(orderId: number): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в систему." };
  const orderRes = await db.execute({
    sql: "SELECT id, ref, status FROM orders WHERE id = ?",
    args: [orderId],
  });
  const order = orderRes.rows[0] as unknown as
    { id: number; ref: string; status: OrderStatus } | undefined;
  if (!order) return { ok: false, message: "Заявка не найдена." };
  if (!canTransition(order.status, "cancelled", user.role)) {
    return { ok: false, message: `Отмена в статусе «${order.status}» недоступна.` };
  }
  // D5.2: cleanup — иначе фантомные брони; D10: отмена сильнее правки — pending очищается там же.
  // Атомарный переход: WHERE status — двойная отмена/гонка с assign не дадут двойных писем.
  await db.batch([
    { sql: "UPDATE orders SET status = 'cancelled', pending_snapshot = NULL, revision_requested_by = NULL, updated_at = ? WHERE id = ? AND status = ?", args: [Math.floor(Date.now() / 1000), orderId, order.status] },
    { sql: "DELETE FROM assignments WHERE order_id = ?", args: [orderId] },
    { sql: "DELETE FROM trips WHERE order_id = ?", args: [orderId] },
  ], "write");
  const cancelCheck = await db.execute({ sql: "SELECT status FROM orders WHERE id = ?", args: [orderId] });
  if ((cancelCheck.rows[0] as unknown as { status: string } | undefined)?.status !== "cancelled") {
    return { ok: false, message: "Заявка уже обработана другим сотрудником." };
  }
  await logOrderEvent(db, orderId, user, "cancelled", { from_status: order.status });
  await audit(db, user.id, "order_cancelled", "order", order.ref, `from=${order.status}`);

  // Уведомление клиенту (не блокирует успех)
  try {
    const contactRes = await db.execute({
      sql: "SELECT contact_email, contact_name, client_id FROM orders WHERE id = ?",
      args: [orderId],
    });
    const contact = contactRes.rows[0] as unknown as { contact_email: string; contact_name: string; client_id: number } | undefined;
    // Клиенту-инициатору отмены не пишем — он и так знает
    if (contact?.contact_email && contact.client_id !== user.id) {
      const { sendOrderCancelledEmail } = await import("./email");
      await sendOrderCancelledEmail(contact.contact_email, contact.contact_name, order.ref);
    }
  } catch (e) {
    console.error("[email] order_cancelled notify failed:", e instanceof Error ? e.message : e);
  }

  return { ok: true, message: "Заявка отменена." };
}

/** Назначение машины и бригады (D5.3–D5.8). */
export async function assignOrderAction(input: { orderId: number; vehicleId: number; driverId: number; codriverId?: number | null }): Promise<AssignResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, error: "auth", message: "Войдите в систему." };
  const result = await assignOrder(db, input, { id: user.id, role: user.role });
  if (result.ok) {
    const refRes = await db.execute({ sql: "SELECT ref FROM orders WHERE id = ?", args: [input.orderId] });
    const ref = refRes.rows[0] as unknown as { ref: string };
    // D10: pending-гвард + статус в историю
    const pendRes = await db.execute({ sql: "SELECT pending_snapshot FROM orders WHERE id = ?", args: [input.orderId] });
    const pend = pendRes.rows[0] as unknown as { pending_snapshot: string | null };
    if (pend.pending_snapshot) {
      return { ok: false, error: "state", message: "Сначала завершите правку: заявка ждёт подтверждения изменения." };
    }
    await logOrderEvent(db, input.orderId, user, "status_changed", { from: "confirmed", to: "assigned", vehicle: input.vehicleId, driver: input.driverId });
    await audit(db, user.id, "order_assigned", "order", ref.ref, `vehicle=${input.vehicleId} driver=${input.driverId}${input.codriverId ? ` co=${input.codriverId}` : ""}`);

    // Уведомление клиенту (не блокирует успех)
    try {
      const infoRes = await db.execute({
        sql: "SELECT contact_email, contact_name, move_date FROM orders WHERE id = ?",
        args: [input.orderId],
      });
      const info = infoRes.rows[0] as unknown as { contact_email: string; contact_name: string; move_date: string } | undefined;
      if (info?.contact_email) {
        const { sendOrderAssignedEmail } = await import("./email");
        await sendOrderAssignedEmail(info.contact_email, info.contact_name, ref.ref, info.move_date);
      }
    } catch (e) {
      console.error("[email] order_assigned notify failed:", e instanceof Error ? e.message : e);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Э5 (D6): день водителя, протокол, приёмка клиентом
// ---------------------------------------------------------------------------

/** «Выехал» (assigned→enroute, только driver, только в день move_date — D6.3). */
export async function startRouteAction(orderId: number): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в систему." };
  if (!canTransition("assigned", "enroute", user.role)) {
    return { ok: false, message: "Недостаточно прав." };
  }
  // Аудит #1: водитель может выехать только на заказ, куда назначен (trips).
  if (user.role === "driver") {
    const tripRes = await db.execute({
      sql: "SELECT id FROM trips WHERE order_id = ? AND (driver_id = ? OR codriver_id = ?)",
      args: [orderId, user.id, user.id],
    });
    if (!tripRes.rows[0]) return { ok: false, message: "Вы не назначены на этот рейс." };
  }
  const orderRes = await db.execute({
    sql: "SELECT id, ref, status, move_date FROM orders WHERE id = ?",
    args: [orderId],
  });
  const order = orderRes.rows[0] as unknown as
    { id: number; ref: string; status: OrderStatus; move_date: string } | undefined;
  if (!order) return { ok: false, message: "Заявка не найдена." };
  if (order.status !== "assigned") {
    return { ok: false, message: `Выехать можно только из статуса «Назначена» (сейчас: ${order.status}).` };
  }
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (order.move_date !== todayIso) {
    return { ok: false, message: `Выезд возможен только в день переезда (${order.move_date}).` };
  }
  // Атомарный переход: WHERE status='assigned' (двойной клик / водитель+админ)
  const startRes = await db.execute({
    sql: "UPDATE orders SET status = 'enroute', updated_at = ? WHERE id = ? AND status = 'assigned'",
    args: [Math.floor(Date.now() / 1000), orderId],
  });
  if (startRes.rowsAffected === 0) return { ok: false, message: "Рейс уже начат или заявка не в статусе «машина назначена»." };
  await logOrderEvent(db, orderId, user, "status_changed", { from: order.status, to: "enroute" }); // D10
  await audit(db, user.id, "order_enroute", "order", order.ref, "");
  return { ok: true, message: "Статус: в пути." };
}

export interface ProtocolInput {
  orderId: number;
  factM3: number;
  items: Array<{ key: string; label: string; checked: boolean }>;
  notes: string;
  signature: string;
}

export interface ProtocolResult { ok: boolean; message?: string }

/**
 * Сохранение протокола (D6.1/D6.2): INSERT-only, только из enroute,
 * глобальная цепочка от GENESIS, существующий протокол = отказ.
 */
export async function saveProtocolAction(input: ProtocolInput): Promise<ProtocolResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в систему." };
  if (user.role !== "driver" && user.role !== "admin") {
    return { ok: false, message: "Протокол составляет водитель." };
  }
  // Аудит #1: водитель подписывает протокол только на своём рейсе (trips).
  if (user.role === "driver") {
    const tripRes = await db.execute({
      sql: "SELECT id FROM trips WHERE order_id = ? AND (driver_id = ? OR codriver_id = ?)",
      args: [input.orderId, user.id, user.id],
    });
    if (!tripRes.rows[0]) return { ok: false, message: "Вы не назначены на этот рейс." };
  }
  const orderRes = await db.execute({
    sql: "SELECT id, ref, status, snapshot, volume_m3 FROM orders WHERE id = ?",
    args: [input.orderId],
  });
  const order = orderRes.rows[0] as unknown as
    { id: number; ref: string; status: OrderStatus; snapshot: string; volume_m3: number } | undefined;
  if (!order) return { ok: false, message: "Заявка не найдена." };
  if (order.status !== "enroute") {
    return { ok: false, message: "Протокол составляется после выезда (статус «В пути»)." };
  }

  // D6.9: валидация факта
  const factM3 = Math.round(input.factM3 * 100) / 100;
  const snap = JSON.parse(order.snapshot) as QuoteSnapshot;
  const capM3 = snap.tariffs.classes[snap.config.vehicleClass]?.capacityM3 ?? Number(order.volume_m3);
  if (!Number.isFinite(factM3) || factM3 < 0 || factM3 > capM3 * 1.5) {
    return { ok: false, message: `Фактический объём должен быть в диапазоне 0–${Math.round(capM3 * 1.5 * 10) / 10} м³.` };
  }
  const notes = input.notes.trim().slice(0, 2000);
  const signature = input.signature.trim();
  if (!signature) return { ok: false, message: "Подпись клиента обязательна." };

  const deviation = Math.round((factM3 - Number(order.volume_m3)) * 100) / 100;
  const loadedJson = JSON.stringify({ plan_m3: Number(order.volume_m3), fact_m3: factM3, items: input.items });
  const signedAt = Math.floor(Date.now() / 1000);

  // Гварды перед записью (TOCTOU, D5.4-паттерн): libsql не имеет интерактивных
  // транзакций — условные повторные проверки + INSERT; гонка отсекается UNIQUE(order_id).
  const freshRes = await db.execute({ sql: "SELECT status FROM orders WHERE id = ?", args: [order.id] });
  const fresh = freshRes.rows[0] as unknown as { status: OrderStatus };
  if (fresh.status !== "enroute") return { ok: false, message: "Статус изменился — обновите страницу." };
  const existing = await db.execute({ sql: "SELECT id FROM protocol WHERE order_id = ?", args: [order.id] });
  if (existing.rows[0]) return { ok: false, message: "Протокол уже подписан — изменить его нельзя." };
  const prevRes = await db.execute("SELECT hash FROM protocol ORDER BY id DESC LIMIT 1");
  const prev = prevRes.rows[0] as unknown as { hash: string } | undefined;
  const prevHash = prev?.hash ?? "GENESIS";
  const hash = sha256(protocolHashString({
    orderId: order.id, loadedJson, deviation, notes, signature, prevHash, signedAt,
  }));
  await db.execute({
    sql: "INSERT INTO protocol (order_id, loaded_json, deviation_m3, notes, signature, prev_hash, hash, signed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [order.id, loadedJson, deviation, notes, signature, prevHash, hash, signedAt],
  });
  await audit(db, user.id, "protocol_signed", "order", order.ref, `deviation=${deviation}`);
  return { ok: true };
}

/** Приёмка клиентом (enroute→acceptance, D5.1/D6.7). */
export async function acceptOrderAction(orderId: number): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в систему." };
  const orderRes = await db.execute({
    sql: "SELECT id, ref, status, client_id FROM orders WHERE id = ?",
    args: [orderId],
  });
  const order = orderRes.rows[0] as unknown as
    { id: number; ref: string; status: OrderStatus; client_id: number | null } | undefined;
  if (!order) return { ok: false, message: "Заявка не найдена." };
  if (!canTransition(order.status, "acceptance", user.role)) {
    return { ok: false, message: "Подтвердить приёмку может клиент после завершения переезда." };
  }
  if (user.role === "kunde" && order.client_id !== user.id) {
    return { ok: false, message: "Это не ваша заявка." };
  }
  const proto = await db.execute({ sql: "SELECT id FROM protocol WHERE order_id = ?", args: [order.id] });
  if (!proto.rows[0]) return { ok: false, message: "Сначала водитель должен составить протокол." };
  // Атомарный переход: WHERE status='enroute' (двойной клик клиента/логиста)
  const accRes = await db.execute({
    sql: "UPDATE orders SET status = 'acceptance', updated_at = ? WHERE id = ? AND status = 'enroute'",
    args: [Math.floor(Date.now() / 1000), orderId],
  });
  if (accRes.rowsAffected === 0) return { ok: false, message: "Приёмка уже подтверждена." };
  await logOrderEvent(db, orderId, user, "status_changed", { from: order.status, to: "acceptance" }); // D10
  await audit(db, user.id, "order_accepted", "order", order.ref, "");

  // Уведомление клиенту — только если приёмку подтвердил не клиент сам (логист/админ)
  if (user.role !== "kunde") {
    try {
      const contactRes = await db.execute({
        sql: "SELECT contact_email, contact_name FROM orders WHERE id = ?",
        args: [orderId],
      });
      const contact = contactRes.rows[0] as unknown as { contact_email: string; contact_name: string } | undefined;
      if (contact?.contact_email) {
        const { sendAcceptanceEmail } = await import("./email");
        await sendAcceptanceEmail(contact.contact_email, contact.contact_name, order.ref);
      }
    } catch (e) {
      console.error("[email] order_accepted notify failed:", e instanceof Error ? e.message : e);
    }
  }

  return { ok: true, message: "Приёмка подтверждена." };
}

// ---------------------------------------------------------------------------
// Э6 (D7): бухгалтерия — закрытие заказа, счета, платежи, дуннинг, претензии
// ---------------------------------------------------------------------------

export interface PaymentInput {
  orderId: number;
  amountCents: number;
  method: "sepa" | "card" | "cash" | "paypal" | "klarna";
  note?: string;
}

export interface PaymentResult { ok: boolean; message?: string }

export type InvoiceRowLike = {
  number: string; order_id: number; amount_cents: number; status: string;
  dunning_level: number; due_date: string; paid_at: number | null;
};

/** Сумма всех платежей заказа (истина денег по D2). */
async function paidSum(db: DB, orderId: number): Promise<number> {
  const r = await db.execute({
    sql: "SELECT COALESCE(SUM(amount_cents), 0) AS s FROM payments WHERE order_id = ?",
    args: [orderId],
  });
  return Number((r.rows[0] as unknown as { s: number }).s);
}

/**
 * Закрытие заказа (acceptance→closed, logist/admin) с созданием
 * счёта RE-ГГГГ-0NNN (D7.1/D7.5) и backfill invoice_id у авансового платежа (D7.1).
 */
export async function closeOrderAction(orderId: number): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в систему." };
  const orderRes = await db.execute({
    sql: "SELECT id, ref, status, gross_cents FROM orders WHERE id = ?",
    args: [orderId],
  });
  const order = orderRes.rows[0] as unknown as
    { id: number; ref: string; status: OrderStatus; gross_cents: number } | undefined;
  if (!order) return { ok: false, message: "Заявка не найдена." };
  if (!canTransition(order.status, "closed", user.role)) {
    return { ok: false, message: `Закрытие возможно из «Приёмка» (сейчас: ${order.status}).` };
  }
  const now = Math.floor(Date.now() / 1000);

  // Гварды (TOCTOU)
  const freshRes = await db.execute({ sql: "SELECT status FROM orders WHERE id = ?", args: [order.id] });
  const fresh = freshRes.rows[0] as unknown as { status: OrderStatus };
  if (!canTransition(fresh.status, "closed", user.role)) {
    return { ok: false, message: "Статус изменился — обновите страницу." };
  }
  const existingRes = await db.execute({ sql: "SELECT number FROM invoices WHERE order_id = ?", args: [order.id] });
  const existing = existingRes.rows[0] as unknown as { number: string } | undefined;
  if (existing) return { ok: false, message: `Счёт уже создан: ${existing.number}.` };

  // GoBD-нумерация через counters (D7.5). Атомарно: UPDATE ... RETURNING.
  const year = new Date().getFullYear();
  await db.execute({
    sql: "INSERT INTO counters (prefix, year, last) VALUES ('RE', ?, 0) ON CONFLICT(prefix, year) DO NOTHING",
    args: [year],
  });
  const upd = await db.execute({
    sql: "UPDATE counters SET last = last + 1 WHERE prefix = 'RE' AND year = ? RETURNING last",
    args: [year],
  });
  const { last } = upd.rows[0] as unknown as { last: number };
  const invoiceNumber = `RE-${year}-${String(last).padStart(4, "0")}`;

  const due = new Date();
  const dueDaysRes = await db.execute("SELECT value FROM config WHERE key = 'finance.due_days'");
  const dueDaysRow = dueDaysRes.rows[0] as unknown as { value: string } | undefined;
  const dueDays = Number(dueDaysRow?.value ?? "14") || 14;
  due.setDate(due.getDate() + dueDays);
  const dueIso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;

  await db.batch([
    { sql: "INSERT INTO invoices (number, order_id, amount_cents, status, dunning_level, due_date) VALUES (?, ?, ?, 'open', 0, ?)", args: [invoiceNumber, order.id, Number(order.gross_cents), dueIso] },
    // D7.1: аванс (payment с invoice_id NULL) привязываем к счёту
    { sql: "UPDATE payments SET invoice_id = ? WHERE order_id = ? AND invoice_id IS NULL", args: [invoiceNumber, order.id] },
    // Атомарный переход: WHERE status='acceptance' (двойной клик / два бухгалтера)
    { sql: "UPDATE orders SET status = 'closed', updated_at = ? WHERE id = ? AND status = 'acceptance'", args: [now, order.id] },
  ], "write");
  // rowsAffected проверяем по orders: если переход не случился — счёт не должен существовать
  const closed = await db.execute({ sql: "SELECT status FROM orders WHERE id = ?", args: [order.id] });
  if ((closed.rows[0] as unknown as { status: string } | undefined)?.status !== "closed") {
    // откатываем случайно созданный счёт (гонка: другой поток закрыл раньше)
    await db.execute({ sql: "DELETE FROM invoices WHERE number = ?", args: [invoiceNumber] });
    return { ok: false, message: "Заказ уже закрыт другим сотрудником." };
  }
  await logOrderEvent(db, order.id, user, "status_changed", { from: order.status, to: "closed", invoice: invoiceNumber }); // D10
  await audit(db, user.id, "invoice_created", "invoice", invoiceNumber, `order=${order.ref} amount=${order.gross_cents}`);

  // Локация машины (@1480@): своя машина остаётся в городе выгрузки (партнёрская — не наша, не двигаем)
  try {
    const subRes = await db.execute({ sql: "SELECT 1 FROM order_subcontractors WHERE order_id = ?", args: [order.id] });
    if (subRes.rows.length === 0) {
      const vehRes = await db.execute({
        sql: "SELECT vehicle_id, seq FROM trips WHERE order_id = ? ORDER BY seq DESC LIMIT 1",
        args: [order.id],
      });
      const trip = vehRes.rows[0] as unknown as { vehicle_id: number } | undefined;
      if (trip) {
        const toRes = await db.execute({ sql: "SELECT to_text FROM orders WHERE id = ?", args: [order.id] });
        const toRow = toRes.rows[0] as unknown as { to_text: string } | undefined;
        if (toRow?.to_text) {
          await db.execute({ sql: "UPDATE vehicles SET current_location = ? WHERE id = ?", args: [toRow.to_text, trip.vehicle_id] });
          await audit(db, user.id, "vehicle_moved", "vehicle", String(trip.vehicle_id), `to=${toRow.to_text}`);
        }
      }
    }
  } catch {
    // локация — вспомогательное поле, не блокирует закрытие
  }

  // Счёт клиенту письмом (не блокирует успех)
  try {
    const contactRes = await db.execute({
      sql: "SELECT contact_email, contact_name FROM orders WHERE id = ?",
      args: [order.id],
    });
    const contact = contactRes.rows[0] as unknown as { contact_email: string; contact_name: string } | undefined;
    if (contact?.contact_email) {
      const { sendInvoiceEmail } = await import("./email");
      await sendInvoiceEmail(contact.contact_email, contact.contact_name, order.ref, invoiceNumber, Number(order.gross_cents), dueIso);
    }
  } catch (e) {
    console.error("[email] invoice notify failed:", e instanceof Error ? e.message : e);
  }

  return { ok: true, message: invoiceNumber };
}

/** Force-close зависшей приёмки (enroute→closed, D7.6): счёт тем же экшеном. */
export async function forceCloseOrderAction(orderId: number): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в систему." };
  const orderRes = await db.execute({
    sql: "SELECT id, ref, status, gross_cents FROM orders WHERE id = ?",
    args: [orderId],
  });
  const order = orderRes.rows[0] as unknown as
    { id: number; ref: string; status: OrderStatus; gross_cents: number } | undefined;
  if (!order) return { ok: false, message: "Заявка не найдена." };
  if (order.status !== "enroute") return { ok: false, message: "Force-close применим только к статусу «В пути»." };
  const proto = await db.execute({ sql: "SELECT id FROM protocol WHERE order_id = ?", args: [order.id] });
  if (!proto.rows[0]) return { ok: false, message: "Сначала нужен протокол водителя." };
  // Переходим в acceptance формально (аудит) и закрываем со счётом
  await db.execute({
    sql: "UPDATE orders SET status = 'acceptance', updated_at = ? WHERE id = ?",
    args: [Math.floor(Date.now() / 1000), order.id],
  });
  await logOrderEvent(db, order.id, user, "status_changed", { from: "enroute", to: "acceptance", forced: true }); // D10
  await audit(db, user.id, "order_force_accepted", "order", order.ref, `from=enroute`);
  return closeOrderAction(orderId);
}

/** Платёж (D7.1/D7.2): положительный = оплата, отрицательный = возврат (D7.4). */
export async function recordPaymentAction(input: PaymentInput): Promise<PaymentResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || (user.role !== "finance" && user.role !== "admin")) {
    return { ok: false, message: "Только бухгалтерия." };
  }
  const orderRes = await db.execute({
    sql: "SELECT id, ref, gross_cents FROM orders WHERE id = ?",
    args: [input.orderId],
  });
  const order = orderRes.rows[0] as unknown as
    { id: number; ref: string; gross_cents: number } | undefined;
  if (!order) return { ok: false, message: "Заказ не найден." };
  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount === 0) return { ok: false, message: "Сумма должна быть не нулевой." };

  const paidBefore = await paidSum(db, order.id);
  const invoiceRes = await db.execute({
    sql: "SELECT number, amount_cents, status FROM invoices WHERE order_id = ?",
    args: [order.id],
  });
  const invoice = invoiceRes.rows[0] as unknown as
    { number: string; amount_cents: number; status: string } | undefined;

  // Возврат (D7.4): только finance, ≤ paid_before, note обязателен
  if (amount < 0) {
    if (!invoice) return { ok: false, message: "Возврат без счёта не производится." };
    const note = (input.note ?? "").trim();
    if (!note) return { ok: false, message: "Для возврата примечание обязательно." };
    if (Math.abs(amount) > paidBefore) return { ok: false, message: "Возврат не может превышать оплаченное." };
    await db.execute({
      sql: "INSERT INTO payments (order_id, invoice_id, amount_cents, method, paid_at, note) VALUES (?, ?, ?, ?, ?, ?)",
      args: [order.id, invoice.number, amount, input.method, Math.floor(Date.now() / 1000), `возврат: ${note}`],
    });
    await audit(db, user.id, "payment_refunded", "order", order.ref, `amount=${amount}`);
    return { ok: true, message: "Возврат записан." };
  }

  // Overpayment блокируется (D7.2)
  if (invoice && paidBefore + amount > Number(invoice.amount_cents)) {
    return { ok: false, message: `Сумма превышает счёт (${(Number(invoice.amount_cents) - paidBefore) / 100} € осталось).` };
  }
  await db.execute({
    sql: "INSERT INTO payments (order_id, invoice_id, amount_cents, method, paid_at, note) VALUES (?, ?, ?, ?, ?, ?)",
    args: [order.id, invoice?.number ?? null, amount, input.method, Math.floor(Date.now() / 1000), (input.note ?? "").trim()],
  });
  if (invoice) {
    // D7.2: paid — деривация. Полное покрытие → paid_at; после возврата (частичное покрытие) → paid_at сброс.
    if (paidBefore + amount >= Number(invoice.amount_cents)) {
      await db.execute({
        sql: "UPDATE invoices SET paid_at = ? WHERE number = ? AND paid_at IS NULL",
        args: [Math.floor(Date.now() / 1000), invoice.number],
      });
    } else {
      await db.execute({ sql: "UPDATE invoices SET paid_at = NULL WHERE number = ?", args: [invoice.number] });
    }
  }
  await audit(db, user.id, "payment_recorded", "order", order.ref, `amount=${amount} method=${input.method}`);
  return { ok: true, message: "Платёж записан." };
}

/** Отмена счёта (D7.5): номер сохраняется (GoBD), для cancelled-заказа / ошибки. */
export async function cancelInvoiceAction(invoiceNumber: string): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || (user.role !== "finance" && user.role !== "admin")) {
    return { ok: false, message: "Только бухгалтерия." };
  }
  const invRes = await db.execute({
    sql: `SELECT i.number, i.paid_at, i.order_id,
      (SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE order_id = i.order_id) AS paid_sum
      FROM invoices i WHERE i.number = ?`,
    args: [invoiceNumber],
  });
  const inv = invRes.rows[0] as unknown as
    { number: string; paid_at: number | null; order_id: number; paid_sum: number } | undefined;
  if (!inv) return { ok: false, message: "Счёт не найден." };
  if (inv.paid_at) return { ok: false, message: "Оплаченный счёт нельзя отменить." };
  if (Number(inv.paid_sum) > 0) {
    return {
      ok: false,
      message: `На заказ этого счёта уже поступило ${Math.round(Number(inv.paid_sum) / 100)} € — сначала оформите возврат платежа, затем отменяйте счёт.`,
    };
  }
  await db.execute({ sql: "UPDATE invoices SET status = 'cancelled' WHERE number = ?", args: [invoiceNumber] });
  await audit(db, user.id, "invoice_cancelled", "invoice", invoiceNumber, "");
  return { ok: true, message: "Счёт отменён (номер сохранён, GoBD)." };
}

/** Ленивый дуннинг-рефреш (D7.3): >14д lvl1, >30д lvl2, только для open/overdue и не in_review. */
export async function dunningRefreshAction(): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || (user.role !== "finance" && user.role !== "admin")) {
    return { ok: false, message: "Только бухгалтерия." };
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const rowsRes = await db.execute(
    "SELECT number, due_date, dunning_level, status, order_id FROM invoices WHERE status IN ('open','overdue') AND paid_at IS NULL",
  );
  const rows = rowsRes.rows as unknown as Array<{ number: string; due_date: string; dunning_level: number; status: string; order_id: number }>;
  let touched = 0;
  let emailed = 0;
  for (const r of rows) {
    if (r.due_date > todayIso) continue;
    const days = Math.floor((Date.now() - new Date(`${r.due_date}T12:00:00`).getTime()) / 86400000);
    const lvl = days > 30 ? 2 : days > 14 ? 1 : 0;
    const newLvl = Math.max(lvl, r.dunning_level);
    const levelUp = newLvl > r.dunning_level;
    if (lvl > r.dunning_level || r.status !== "overdue") {
      await db.execute({
        sql: "UPDATE invoices SET dunning_level = ?, status = 'overdue' WHERE number = ?",
        args: [newLvl, r.number],
      });
      touched++;
      // Аудит #4: при повышении уровня дуннинга — письмо клиенту (не блокирует refresh).
      if (levelUp) {
        try {
          const oRes = await db.execute({
            sql: "SELECT ref, contact_email FROM orders WHERE id = ?",
            args: [r.order_id],
          });
          const o = oRes.rows[0] as unknown as { ref: string; contact_email: string } | undefined;
          if (o && !o.contact_email.endsWith("@deleted.local")) {
            const { sendEmail } = await import("./email");
            const daysTxt = newLvl >= 2 ? "более 30 дней" : "более 14 дней";
            await sendEmail(
              o.contact_email,
              `Просрочка оплаты по счёту ${r.number} — Umzug Service`,
              `<div style="font-family:sans-serif;max-width:560px">
                <p>Уважаемый клиент, оплата по счёту <b>${r.number}</b> (заявка ${o.ref}) просрочена на ${daysTxt}.</p>
                <p>Просьба погасить задолженность или связаться с нами для уточнения деталей.</p>
                <p><a href="${process.env.NEXT_PUBLIC_SITE_URL ?? "https://umzug-seven.vercel.app"}/order/${o.ref}">Открыть заявку ${o.ref}</a></p>
              </div>`,
            );
            emailed++;
          }
        } catch (e) {
          console.error("dunning email failed:", e);
        }
      }
    }
  }
  await audit(db, user.id, "dunning_refresh", "invoice", "", `touched=${touched} emailed=${emailed}`);
  return { ok: true, message: `Дуннинг обновлён: счетов затронуто ${touched}, писем отправлено ${emailed}.` };
}

/** Претензия вручную (D7.8): finance/admin, компенсация = отрицательный payment отдельным экшеном. */
export async function createClaimAction(input: { orderId: number; item: string; amountCents: number }): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || (user.role !== "finance" && user.role !== "admin")) {
    return { ok: false, message: "Только бухгалтерия." };
  }
  const orderRes = await db.execute({ sql: "SELECT id, ref FROM orders WHERE id = ?", args: [input.orderId] });
  const order = orderRes.rows[0] as unknown as { id: number; ref: string } | undefined;
  if (!order) return { ok: false, message: "Заказ не найден." };
  const item = input.item.trim().slice(0, 200);
  if (!item) return { ok: false, message: "Укажите предмет претензии." };
  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Сумма претензии должна быть положительной." };
  const year = new Date().getFullYear();
  await db.execute({
    sql: "INSERT INTO counters (prefix, year, last) VALUES ('SC', ?, 0) ON CONFLICT(prefix, year) DO NOTHING",
    args: [year],
  });
  const upd = await db.execute({
    sql: "UPDATE counters SET last = last + 1 WHERE prefix = 'SC' AND year = ? RETURNING last",
    args: [year],
  });
  const { last } = upd.rows[0] as unknown as { last: number };
  const number = `SC-${year}-${String(last).padStart(4, "0")}`;
  await db.execute({
    sql: "INSERT INTO claims (number, order_id, item, amount_cents, status, resolution, created_at) VALUES (?, ?, ?, ?, 'new', '', ?)",
    args: [number, order.id, item, amount, Math.floor(Date.now() / 1000)],
  });
  await audit(db, user.id, "claim_created", "claim", number, `order=${order.ref}`);
  return { ok: true, message: number };
}

/** Смена статуса претензии (D7.8). */
export async function updateClaimStatusAction(claimNumber: string, status: string): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || (user.role !== "finance" && user.role !== "admin")) {
    return { ok: false, message: "Только бухгалтерия." };
  }
  const allowed = ["new", "in_review", "offer", "resolved", "rejected"];
  if (!allowed.includes(status)) return { ok: false, message: "Недопустимый статус." };
  const claimRes = await db.execute({ sql: "SELECT number FROM claims WHERE number = ?", args: [claimNumber] });
  if (!claimRes.rows[0]) return { ok: false, message: "Претензия не найдена." };
  await db.execute({ sql: "UPDATE claims SET status = ? WHERE number = ?", args: [status, claimNumber] });
  await audit(db, user.id, "claim_status", "claim", claimNumber, `to=${status}`);
  return { ok: true };
}

// ─── Э7: Админ-панель (D8) ───────────────────────────────────────────────

export interface TariffBatchResult extends SimpleResult {
  errors?: { key: string; message: string }[];
  clamped?: string[];
}

/** Тарифы батчем (D8.1): validate-all-then-write, одна строка аудита с JSON-diff. */
export async function updateTariffsAction(values: Record<string, string>): Promise<TariffBatchResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Только админ." };

  const normalized: Record<string, string> = {};
  const errors: { key: string; message: string }[] = [];
  const clamped: string[] = [];
  const keys = Object.keys(values);
  let before = new Map<string, string>();
  if (keys.length > 0) {
    const beforeRes = await db.execute({
      sql: "SELECT key, value FROM config WHERE key IN (" + keys.map(() => "?").join(",") + ")",
      args: keys,
    });
    before = new Map((beforeRes.rows as unknown as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  }

  // Проход 1: валидация всех
  for (const [key, raw] of Object.entries(values)) {
    try {
      const s = CONFIG_SCHEMA[key];
      const n = normalizeConfigValue(key, raw);
      if (!s) continue;
      const num = Number(n);
      const rawNum = Number(raw.replace(",", "."));
      if (Number.isFinite(num) && Number.isFinite(rawNum) && num !== rawNum) clamped.push(key);
      normalized[key] = n;
    } catch (e) {
      errors.push({ key, message: e instanceof Error ? e.message : "Ошибка" });
    }
  }
  if (errors.length > 0) return { ok: false, errors, message: `Ошибок: ${errors.length}` };

  // Проход 2: запись всех
  const changed: Record<string, { from: string; to: string }> = {};
  for (const [key, value] of Object.entries(normalized)) {
    if (before.get(key) !== value) changed[key] = { from: before.get(key) ?? "", to: value };
    await writeConfigValue(db, key, value);
  }

  if (Object.keys(changed).length > 0) {
    await audit(db, user.id, "config_update", "config", "", JSON.stringify(changed));
  }
  return { ok: true, clamped, message: `Сохранено. Изменено: ${Object.keys(changed).length}.` };
}

/** Класс машины (D8.4): label/capacity/included/base/active; capacity синхронизируется у машин класса. */
export async function updateVehicleClassAction(input: {
  cls: string; label: string; capacityM3: number; includedM3: number; baseCents: number; active: boolean;
}): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Только админ." };
  if (!["A", "B", "C"].includes(input.cls)) return { ok: false, message: "Неизвестный класс." };
  const capacity = Math.round(input.capacityM3);
  const included = Math.round(input.includedM3);
  const base = Math.round(input.baseCents);
  if (capacity < 1 || capacity > 100) return { ok: false, message: "Вместимость 1–100 м³." };
  if (included < 0 || included > capacity) return { ok: false, message: "Включённый объём 0…вместимость." };
  if (base < 0 || base > 10_000_00) return { ok: false, message: "Базовая цена 0–10000 €." };
  if (!input.label.trim()) return { ok: false, message: "Название не может быть пустым." };

  await db.batch([
    { sql: "UPDATE vehicle_classes SET label = ?, capacity_m3 = ?, included_m3 = ?, base_cents = ?, active = ? WHERE class = ?", args: [input.label.trim().slice(0, 100), capacity, included, base, input.active ? 1 : 0, input.cls] },
    // D8.4: capacity single-source — синхронизируем денорм у машин (только если класс активен)
    ...(input.active ? [{ sql: "UPDATE vehicles SET capacity_m3 = ? WHERE class = ?", args: [capacity, input.cls] }] : []),
  ], "write");
  await audit(db, user.id, "vehicle_class_update", "vehicle_class", input.cls,
    `capacity=${capacity} included=${included} base=${base} active=${input.active}`);
  return { ok: true, message: "Класс обновлён." };
}

/** Пользователь staff (D8.2/D8.3): role/active/password с last-admin guard. */
export async function updateStaffUserAction(input: {
  userId: number; role?: string; active?: boolean; newPassword?: string;
}): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Только админ." };
  const targetRes = await db.execute({
    sql: "SELECT id, email, role, active FROM users WHERE id = ?",
    args: [input.userId],
  });
  const target = targetRes.rows[0] as unknown as
    { id: number; email: string; role: string; active: number } | undefined;
  if (!target) return { ok: false, message: "Пользователь не найден." };

  const targetIsAdmin = target.role === "admin";
  const self = target.id === user.id;
  const demoteOrDeactivate = (input.role && input.role !== "admin") || input.active === false;
  if (targetIsAdmin && (self || input.role !== undefined || input.active !== undefined)) {
    const adminCountRes = await db.execute("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1");
    const adminCount = adminCountRes.rows[0] as unknown as { c: number };
    if (Number(adminCount.c) === 1 && (demoteOrDeactivate || (self && input.newPassword))) {
      return { ok: false, message: "Нельзя понизить/деактивировать/сбросить пароль последнему активному админу." };
    }
  }

  const notes: string[] = [];
  if (input.role && input.role !== target.role && ["kunde", "logist", "driver", "finance", "admin"].includes(input.role)) {
    await db.execute({ sql: "UPDATE users SET role = ? WHERE id = ?", args: [input.role, target.id] });
    notes.push(`role=${input.role}`);
  }
  if (input.active !== undefined && input.active !== (target.active === 1)) {
    await db.execute({ sql: "UPDATE users SET active = ? WHERE id = ?", args: [input.active ? 1 : 0, target.id] });
    if (!input.active) await invalidateUserSessions(db, target.id);
    notes.push(`active=${input.active}`);
  }
  if (input.newPassword) {
    if (input.newPassword.length < 8) return { ok: false, message: "Пароль от 8 символов." }; // валидировано в UI, тут страховка
    await db.execute({
      sql: "UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?",
      args: [hashPassword(input.newPassword), target.id],
    });
    await invalidateUserSessions(db, target.id); // D8.3: сброс пароля инвалидирует сессии
    notes.push("password_reset");
  }

  if (notes.length > 0) await audit(db, user.id, "user_update", "user", String(target.id), notes.join(" "));
  return { ok: true, message: notes.length > 0 ? `Обновлено: ${notes.join(", ")}.` : "Без изменений." };
}

/** Создание сотрудника админом (D8.2 расширение): водители, бухгалтеры, логисты, грузчики*. */
export async function createStaffUserAction(input: {
  name: string; email: string; role: string; password: string;
}): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Только админ." };

  const name = input.name.trim().replace(/\s+/g, " ");
  const email = input.email.trim().toLowerCase();
  if (!isValidLatinName(name)) return { ok: false, message: "Имя — латиницей, два слова (имя и фамилия), как в документах." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Некорректный email." };
  if (input.password.length < 8) return { ok: false, message: "Пароль от 8 символов." };
  // Грузчики (mover) не входят в ролевую модель (нет доступа к системе) —
  // грузчики работают в экипаже, но учётной записи не требуется. Допустимые роли:
  const role = input.role;
  if (!["kunde", "logist", "driver", "finance", "admin"].includes(role)) {
    return { ok: false, message: "Недопустимая роль." };
  }
  if (role === "admin") {
    // страховка: сознательное действие, но фиксируем
  }

  const existingRes = await db.execute({
    sql: "SELECT id, email_verified FROM users WHERE email = ?",
    args: [email],
  });
  const existing = existingRes.rows[0] as unknown as { id: number; email_verified: number } | undefined;
  if (existing) {
    if (existing.email_verified === 1) return { ok: false, message: "Пользователь с таким email уже существует." };
    // Неподтверждённая регистрация — обновляем до сотрудника
    await db.execute({
      sql: "UPDATE users SET name = ?, password_hash = ?, role = ?, email_verified = 1 WHERE id = ?",
      args: [name, hashPassword(input.password), role, existing.id],
    });
    await audit(db, user.id, "user_update", "user", String(existing.id), `admin-created-staff role=${role}`);
    return { ok: true, message: "Сотрудник создан (email был зарегистрирован ранее, теперь активирован)." };
  }

  const res = await db.execute({
    sql: "INSERT INTO users (name, email, password_hash, role, email_verified, active, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)",
    args: [name, email, hashPassword(input.password), role, Math.floor(Date.now() / 1000)],
  });
  await audit(db, user.id, "user_create", "user", String(res.lastInsertRowid), `staff role=${role} email=${email}`);
  return { ok: true, message: `Сотрудник создан: ${name} (${email}), роль ${role}. Может войти сразу.` };
}

// ─── D10: двусторонняя корректировка заказа ──────────────────────────────

/** Какие поля MoveConfig можно менять правкой (адреса/дата — не редактируются, только отмена+новая заявка). */
const REVISABLE_FIELDS = ["volumeM3", "floorsFrom", "floorsTo", "elevatorFrom", "elevatorTo", "boxes", "kitchen", "furnitureItems", "packHours", "hvzZones", "extraCrew", "express", "sharedLoad"] as const;

export interface RevisionResult extends SimpleResult { ref?: string }

async function loadOrderForRevision(db: DB, orderId: number): Promise<OrderForRevision | null> {
  const res = await db.execute({
    sql: "SELECT id, ref, status, client_id, pending_snapshot, revision_requested_by, move_date, created_at, snapshot, express FROM orders WHERE id = ?",
    args: [orderId],
  });
  return (res.rows[0] as unknown as OrderForRevision | undefined) ?? null;
}

/** Дифф изменений для history.details (только ревизуемые поля). */
function revisionDiff(before: MoveConfig, patch: Partial<MoveConfig>): Record<string, { from: unknown; to: unknown }> {
  const fields: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of REVISABLE_FIELDS) {
    if (patch[k as keyof MoveConfig] !== undefined && patch[k as keyof MoveConfig] !== before[k as keyof MoveConfig]) {
      fields[k] = { from: before[k as keyof MoveConfig], to: patch[k as keyof MoveConfig] };
    }
  }
  return fields;
}

/** Предложить правку (обе стороны): пишет pending_snapshot,history; подтверждает ДРУГАЯ сторона. */
export async function proposeRevisionAction(input: { orderId: number; patch: Partial<MoveConfig>; reason?: string }): Promise<RevisionResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в систему." };
  const role = user.role as "kunde" | "logist" | "admin";
  // admin действует как logist; клиент — только kunde
  if (role !== "kunde" && role !== "logist" && role !== "admin") {
    return { ok: false, message: "Правки недоступны для этой роли." };
  }
  const revRole: "kunde" | "logist" = role === "kunde" ? "kunde" : "logist";

  // владелец: kunde может править только свой заказ
  const order0 = await loadOrderForRevision(db, input.orderId);
  if (!order0) return { ok: false, message: "Заявка не найдена." };
  if (revRole === "kunde" && order0.client_id !== user.id) {
    return { ok: false, message: "Это не ваша заявка." };
  }

  const built = await buildRevisionSnapshot(db, order0, input.patch, revRole);
  if (!built.ok) return { ok: false, message: built.reason };

  // Single-writer (критик 2): условный UPDATE — только если pending_snapshot ещё NULL
  const snapJson = JSON.stringify(built.snapshot);
  const res = await db.execute({
    sql: "UPDATE orders SET pending_snapshot = ?, revision_requested_by = ?, updated_at = ? WHERE id = ? AND pending_snapshot IS NULL AND status IN ('new','confirmed')",
    args: [snapJson, revRole, Math.floor(Date.now() / 1000), order0.id],
  });
  if (res.rowsAffected === 0) {
    return { ok: false, message: "Не удалось: у заказа уже есть активная правка или статус изменился." };
  }

  const diff = revisionDiff((JSON.parse(order0.snapshot) as QuoteSnapshot).config, input.patch);
  const fields = Object.keys(diff);
  if (fields.length === 0) {
    // откатить pending (мы его уже поставили — но diff пустой значит снимок тот же)
    await db.execute({
      sql: "UPDATE orders SET pending_snapshot = NULL, revision_requested_by = NULL WHERE id = ?",
      args: [order0.id],
    });
    return { ok: false, message: "Изменений нет." };
  }
  const oldGrossRes = await db.execute({ sql: "SELECT gross_cents FROM orders WHERE id = ?", args: [order0.id] });
  const oldGross = Number((oldGrossRes.rows[0] as unknown as { gross_cents: number }).gross_cents);
  await logOrderEvent(db, order0.id, user, "revision_proposed", {
    fields: diff,
    old_gross: oldGross,
    new_gross: built.quote.gross,  // built.quote из buildRevisionSnapshot (calculateQuote результат)
    reason: input.reason?.slice(0, 200),
  });
  return { ok: true, message: `Правка предложена (${fields.join(", ")}). Ожидает подтверждения другой стороны.`, ref: order0.ref };
}

/** Подтвердить правку: proposer ≠ confirmer; атомарно снять флаг + заменить снимок + версии + история. */
export async function acceptRevisionAction(orderId: number): Promise<RevisionResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в систему." };
  const order = await loadOrderForRevision(db, orderId);
  if (!order) return { ok: false, message: "Заявка не найдена." };
  if (!order.pending_snapshot) return { ok: false, message: "Активной правки нет." };

  // proposer ≠ confirmer (критик 1/2): kunde подтверждает предложение logist, logist/admin — предложение kunde
  const proposer = order.revision_requested_by;
  if (user.role === "kunde" && proposer !== "logist") return { ok: false, message: "Подтвердить может только другая сторона." };
  if ((user.role === "logist" || user.role === "admin") && proposer !== "kunde") return { ok: false, message: "Подтвердить может только другая сторона." };
  if (user.role === "kunde" && order.client_id !== user.id) return { ok: false, message: "Это не ваша заявка." };

  const oldSnap = JSON.parse(order.snapshot) as QuoteSnapshot;
  const newSnap = JSON.parse(order.pending_snapshot) as QuoteSnapshot;
  const newQuote = recalculate(newSnap);
  const curVersionRes = await db.execute({ sql: "SELECT current_version FROM orders WHERE id = ?", args: [orderId] });
  const curVersion = Number((curVersionRes.rows[0] as unknown as { current_version: number }).current_version);
  const oldGrossRes = await db.execute({ sql: "SELECT gross_cents FROM orders WHERE id = ?", args: [orderId] });
  const oldGross = Number((oldGrossRes.rows[0] as unknown as { gross_cents: number }).gross_cents);

  // Гвард-UPDATE + пересборка lines одним batch (атомарно, D10)
  const upd = await db.execute({
    sql: "UPDATE orders SET snapshot = ?, pending_snapshot = NULL, revision_requested_by = NULL, volume_m3 = ?, distance_km = ?, net_cents = ?, vat_cents = ?, gross_cents = ?, deposit_cents = ?, remainder_cents = ?, express = ?, shared_load = ?, updated_at = ? WHERE id = ? AND pending_snapshot IS NOT NULL",
    args: [
      JSON.stringify(newSnap), newSnap.config.volumeM3, oldSnap.config.distanceKm,
      newQuote.net, newQuote.vat, newQuote.gross, newQuote.deposit, newQuote.remainder,
      newSnap.config.express ? 1 : 0, newSnap.config.sharedLoad ? 1 : 0,
      Math.floor(Date.now() / 1000), orderId,
    ],
  });
  if (upd.rowsAffected === 0) {
    return { ok: false, message: "Правка уже обработана — обновите страницу." };
  }
  // order_lines пересобрать из нового снимка (projection D4.9)
  await db.batch([
    { sql: "DELETE FROM order_lines WHERE order_id = ?", args: [orderId] },
    ...newQuote.lines.map((l, i) => ({
      sql: "INSERT INTO order_lines (order_id, idx, kind, key, label, amount, meta) VALUES (?, ?, 'line', ?, ?, ?, ?)",
      args: [orderId, i, l.key, l.label, l.amount, l.meta ? JSON.stringify(l.meta) : "{}"],
    })),
  ], "write");
  const newVersion = await saveSnapshotVersion(db, orderId, JSON.stringify(newSnap), newQuote.gross, user.id);

  await logOrderEvent(db, orderId, user, "revision_accepted", {
    from_gross: oldGross, to_gross: newQuote.gross, snapshot_versions: [curVersion, newVersion],
  });
  return { ok: true, message: "Правка принята — цена обновлена." };
}

/** Отклонить правку: proposer ≠ confirmer; снимок не меняется. */
export async function rejectRevisionAction(orderId: number): Promise<RevisionResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в систему." };
  const order = await loadOrderForRevision(db, orderId);
  if (!order) return { ok: false, message: "Заявка не найдена." };
  if (!order.pending_snapshot) return { ok: false, message: "Активной правки нет." };
  const proposer = order.revision_requested_by;
  if (user.role === "kunde" && proposer !== "logist") return { ok: false, message: "Отклонить может только другая сторона." };
  if ((user.role === "logist" || user.role === "admin") && proposer !== "kunde") return { ok: false, message: "Отклонить может только другая сторона." };
  if (user.role === "kunde" && order.client_id !== user.id) return { ok: false, message: "Это не ваша заявка." };

  const pendingGross = recalculate(JSON.parse(order.pending_snapshot) as QuoteSnapshot).gross;
  const upd = await db.execute({
    sql: "UPDATE orders SET pending_snapshot = NULL, revision_requested_by = NULL, updated_at = ? WHERE id = ? AND pending_snapshot IS NOT NULL",
    args: [Math.floor(Date.now() / 1000), orderId],
  });
  if (upd.rowsAffected === 0) {
    return { ok: false, message: "Правка уже обработана — обновите страницу." };
  }
  await logOrderEvent(db, orderId, user, "revision_rejected", { rejected_gross: pendingGross });
  return { ok: true, message: "Правка отклонена — заказ остаётся по прежней цене." };
}

/** Машина create/edit (D8.6): plate/class/label/capacity/active; delete отдельно. */
export async function saveVehicleAction(input: {
  vehicleId?: number; plate: string; cls: string; label: string; active: boolean; homeBase?: string;
}): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Только админ." };
  const plate = input.plate.trim().toUpperCase().slice(0, 20);
  if (!plate) return { ok: false, message: "Укажите номер." };
  if (!["A", "B", "C"].includes(input.cls)) return { ok: false, message: "Неизвестный класс." };
  const clsRes = await db.execute({
    sql: "SELECT capacity_m3 FROM vehicle_classes WHERE class = ? AND active = 1",
    args: [input.cls],
  });
  const cls = clsRes.rows[0] as unknown as { capacity_m3: number } | undefined;
  if (!cls) return { ok: false, message: "Класс не найден или деактивирован." };
  const label = input.label.trim().slice(0, 100);
  const homeBase = input.homeBase?.trim().slice(0, 200) ?? "";

  if (input.vehicleId) {
    const dupRes = await db.execute({
      sql: "SELECT id FROM vehicles WHERE plate = ? AND id != ?",
      args: [plate, input.vehicleId],
    });
    if (dupRes.rows[0]) return { ok: false, message: "Такой номер уже есть." };
    await db.batch([
      { sql: "UPDATE vehicles SET plate = ?, class = ?, label = ?, active = ? WHERE id = ?", args: [plate, input.cls, label, input.active ? 1 : 0, input.vehicleId] },
      // capacity денорм обновится через updateVehicleClassAction; здесь актуализируем сразу
      { sql: "UPDATE vehicles SET capacity_m3 = (SELECT capacity_m3 FROM vehicle_classes WHERE class = ?) WHERE id = ?", args: [input.cls, input.vehicleId] },
      // home_base: пустой ввод = не менять (для существующей машины)
      { sql: "UPDATE vehicles SET home_base = CASE WHEN ? = '' THEN home_base ELSE ? END WHERE id = ?", args: [homeBase, homeBase, input.vehicleId] },
    ], "write");
    await audit(db, user.id, "vehicle_update", "vehicle", String(input.vehicleId), `plate=${plate} class=${input.cls}`);
    return { ok: true, message: "Машина обновлена." };
  }
  const dupRes = await db.execute({ sql: "SELECT id FROM vehicles WHERE plate = ?", args: [plate] });
  if (dupRes.rows[0]) return { ok: false, message: "Такой номер уже есть." };
  const res = await db.execute({
    sql: "INSERT INTO vehicles (plate, class, label, capacity_m3, active, home_base, current_location) VALUES (?, ?, ?, (SELECT capacity_m3 FROM vehicle_classes WHERE class = ?), ?, ?, ?)",
    args: [plate, input.cls, label, input.cls, input.active ? 1 : 0, homeBase, homeBase],
  });
  await audit(db, user.id, "vehicle_created", "vehicle", String(res.lastInsertRowid), `plate=${plate} class=${input.cls}`);
  return { ok: true, message: "Машина добавлена." };
}

/** Машина вернулась на базу (@1480@): current_location = home_base. */
export async function returnVehicleAction(vehicleId: number): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Только админ." };
  const vRes = await db.execute({ sql: "SELECT home_base FROM vehicles WHERE id = ?", args: [vehicleId] });
  const v = vRes.rows[0] as unknown as { home_base: string } | undefined;
  if (!v) return { ok: false, message: "Машина не найдена." };
  if (!v.home_base) return { ok: false, message: "У машины не указана база (home_base) — укажите её в форме сохранения." };
  await db.execute({ sql: "UPDATE vehicles SET current_location = home_base WHERE id = ?", args: [vehicleId] });
  await audit(db, user.id, "vehicle_returned", "vehicle", String(vehicleId), `to=${v.home_base}`);
  return { ok: true, message: "Машина возвращена на базу." };
}

/** Удаление машины (D8.6): блок, если есть заказы/рейсы. */
export async function deleteVehicleAction(vehicleId: number): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Только админ." };
  const referencedRes = await db.execute({
    sql: "SELECT (SELECT COUNT(*) FROM trips WHERE vehicle_id = ?) + (SELECT COUNT(*) FROM assignments WHERE resource_type = 'vehicle' AND resource_id = ?) AS n",
    args: [vehicleId, vehicleId],
  });
  const referenced = referencedRes.rows[0] as unknown as { n: number };
  if (Number(referenced.n) > 0) {
    return { ok: false, message: "Машину нельзя удалить: есть рейсы/назначения. Деактивируйте её." };
  }
  await db.execute({ sql: "DELETE FROM vehicles WHERE id = ?", args: [vehicleId] });
  await audit(db, user.id, "vehicle_deleted", "vehicle", String(vehicleId));
  return { ok: true, message: "Машина удалена." };
}

/** maps.api_key (D8.5): пустой submit = не менять; аудит без значения. */
export async function updateApiKeyAction(raw: string): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Только админ." };
  const value = raw.trim().slice(0, 200);
  if (!value) return { ok: true, message: "Пусто — ключ не изменён." };
  const hasKeyRes = await db.execute("SELECT value FROM config WHERE key = 'maps.api_key'");
  const hasKey = hasKeyRes.rows[0] as unknown as { value: string } | undefined;
  await writeConfigValue(db, "maps.api_key", value);
  await audit(db, user.id, "maps_key_updated", "config", "maps.api_key",
    hasKey && hasKey.value ? "replaced" : "set");
  return { ok: true, message: "Ключ сохранён." };
}

/**
 * GDPR ст. 17: удаление аккаунта клиента через анонимизацию.
 * GoBD § 147 AO / § 257 HGB требуют хранения бухгалтерских записей 8–10 лет,
 * поэтому строки orders/invoices/payments не удаляются — обезличиваются:
 * email → anon-<hash8>@deleted.local, name → «(удалено)», active = 0.
 * Активные заявки (new..acceptance) блокируют удаление.
 */
export async function deleteAccountAction(): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в аккаунт." };
  if (user.role !== "kunde") return { ok: false, message: "Удаление доступно только клиентам. Обратитесь к администратору." };

  const activeRes = await db.execute({
    sql: "SELECT COUNT(*) AS c FROM orders WHERE client_id = ? AND status IN ('new','confirmed','assigned','enroute','acceptance')",
    args: [user.id],
  });
  const activeCount = Number((activeRes.rows[0] as unknown as { c: number }).c);
  if (activeCount > 0) {
    return { ok: false, message: `Нельзя удалить аккаунт: ${activeCount} активн${activeCount === 1 ? "ая заявка" : "ых заявки"}. Отмените или дождитесь закрытия.` };
  }

  const salt = randomBytes(4).toString("hex");
  const anonEmail = `anon-${sha256(user.email).slice(0, 8)}-${salt}@deleted.local`;
  await db.execute({
    sql: "UPDATE users SET email = ?, name = '(удалено)', active = 0, verify_token = NULL, verify_expires = NULL, reset_token = NULL, reset_expires = NULL WHERE id = ?",
    args: [anonEmail, user.id],
  });
  // Контактные данные в самих заказах тоже обезличиваем (email/имя в заявках).
  await db.execute({
    sql: "UPDATE orders SET contact_email = ?, contact_name = '(удалено)' WHERE client_id = ?",
    args: [anonEmail, user.id],
  });
  // Аудит #6: переписка инбокса тоже обезличивается (ст. 17 DSGVO).
  await db.execute({
    sql: `UPDATE messages SET from_email = ?, from_user_id = NULL
      WHERE from_user_id = ? OR from_email IN (
        SELECT contact_email FROM orders WHERE client_id = ?
      )`,
    args: [anonEmail, user.id, user.id],
  });
  await invalidateUserSessions(db, user.id);
  await audit(db, user.id, "account_anonymized", "user", String(user.id), `anon=${anonEmail}`);
  return { ok: true, message: "Аккаунт удалён (данные анонимизированы согласно GoBD)." };
}

// ─── Задача 9: инбокс — сообщения по заявке (клиент ↔ персонал) ───────────

export async function sendMessageAction(orderRef: string, body: string): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в аккаунт." };

  const text = body.trim().slice(0, 2000);
  if (text.length < 2) return { ok: false, message: "Сообщение слишком короткое." };

  const orderRes = await db.execute({
    sql: "SELECT id, client_id, ref, contact_email FROM orders WHERE ref = ?",
    args: [orderRef],
  });
  const order = orderRes.rows[0] as unknown as { id: number; client_id: number; ref: string; contact_email: string } | undefined;
  if (!order) return { ok: false, message: "Заявка не найдена." };

  // Клиент пишет только в свою заявку; персонал — в любую.
  if (user.role === "kunde" && order.client_id !== user.id) {
    return { ok: false, message: "Нет доступа к этой заявке." };
  }

  await db.execute({
    sql: "INSERT INTO messages (order_id, from_role, from_user_id, from_email, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [order.id, user.role, user.id, user.email, text, Math.floor(Date.now() / 1000)],
  });
  await audit(db, user.id, "message_sent", "order", order.ref, `role=${user.role} len=${text.length}`);

  // Письмо-уведомление адресату (не блокирует успех действия).
  try {
    // Аудит #7: анонимизированным клиентам (deleted.local) письма не отправляем.
    if (!order.contact_email.endsWith("@deleted.local")) {
      const { sendEmail } = await import("./email");
      const staff = user.role !== "kunde";
      const to = order.contact_email;
      const subject = staff
        ? `Ответ по заявке ${order.ref} — Umzug Service`
        : `Новое сообщение по заявке ${order.ref} — Umzug Service`;
      const html = `<div style="font-family:sans-serif;max-width:560px">
        <p>${staff ? "Ответ персонала по вашей заявке" : "Новое сообщение по вашей заявке"} <b>${order.ref}</b>:</p>
        <blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#333">${text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</blockquote>
        <p>Открыть заявку: <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? "https://umzug-seven.vercel.app"}/order/${order.ref}">${order.ref}</a></p>
      </div>`;
      await sendEmail(to, subject, html);
    }
  } catch {
    // уведомление необязательно
  }

  return { ok: true, message: "Сообщение отправлено." };
}

export async function markMessagesReadAction(orderRef: string): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в аккаунт." };

  const orderRes = await db.execute({
    sql: "SELECT id, client_id FROM orders WHERE ref = ?",
    args: [orderRef],
  });
  const order = orderRes.rows[0] as unknown as { id: number; client_id: number } | undefined;
  if (!order) return { ok: false, message: "Заявка не найдена." };
  if (user.role === "kunde" && order.client_id !== user.id) {
    return { ok: false, message: "Нет доступа к этой заявке." };
  }

  await db.execute({
    sql: "UPDATE messages SET read_at = ? WHERE order_id = ? AND read_at IS NULL AND from_role <> ?",
    args: [Math.floor(Date.now() / 1000), order.id, user.role],
  });
  return { ok: true, message: "Отмечено прочитанным." };
}

// ─── Субподрядчики (сторонние перевозчики, требование @1480@) ────────────────

export type SubPriceMode = "per_km" | "per_order" | "per_day";

export interface SubResult extends SimpleResult {
  subId?: number;
}

export async function createSubcontractorAction(
  input: { name: string; contact: string; phone: string; email: string; cls: VehicleClass; priceMode: SubPriceMode; priceCents: number; notes: string },
): Promise<SubResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Только администратор." };

  const name = input.name.trim();
  if (name.length < 2) return { ok: false, message: "Укажите название партнёра." };
  const priceMode: SubPriceMode = input.priceMode;
  if (!["per_km", "per_order", "per_day"].includes(priceMode)) return { ok: false, message: "Неверный режим тарифа." };
  const priceCents = Math.round(Number(input.priceCents));
  if (!Number.isFinite(priceCents) || priceCents <= 0) return { ok: false, message: "Тариф должен быть больше нуля." };

  const res = await db.execute({
    sql: "INSERT INTO subcontractors (name, contact, phone, email, class, price_mode, price_cents, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
    args: [name, input.contact.trim(), input.phone.trim(), input.email.trim(), input.cls, priceMode, priceCents, input.notes.trim()],
  });
  const subId = Number(res.lastInsertRowid);
  await audit(db, user.id, "sub_created", "subcontractor", String(subId), `name=${name} mode=${priceMode} price=${(priceCents / 100).toFixed(2)}€`);
  return { ok: true, message: `Партнёр «${name}» добавлен.`, subId };
}

export async function toggleSubcontractorAction(subId: number): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Только администратор." };

  const res = await db.execute({
    sql: "UPDATE subcontractors SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?",
    args: [subId],
  });
  if (res.rowsAffected === 0) return { ok: false, message: "Партнёр не найден." };
  await audit(db, user.id, "sub_toggled", "subcontractor", String(subId));
  return { ok: true, message: "Статус партнёра изменён." };
}

export async function assignSubcontractorAction(orderId: number, subId: number, costCents?: number): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || !["logist", "admin"].includes(user.role)) return { ok: false, message: "Недостаточно прав." };

  const orderRes = await db.execute({
    sql: "SELECT id, ref, status, vehicle_class, move_date FROM orders WHERE id = ?",
    args: [orderId],
  });
  const order = orderRes.rows[0] as unknown as { id: number; ref: string; status: string; vehicle_class: VehicleClass; move_date: string } | undefined;
  if (!order) return { ok: false, message: "Заявка не найдена." };

  const subRes = await db.execute({
    sql: "SELECT id, name, class, price_mode, price_cents, active FROM subcontractors WHERE id = ?",
    args: [subId],
  });
  const sub = subRes.rows[0] as unknown as { id: number; name: string; class: VehicleClass; price_mode: SubPriceMode; price_cents: number; active: number } | undefined;
  if (!sub || !Number(sub.active)) return { ok: false, message: "Партнёр не найден или неактивен." };
  if (CLASS_RANK[sub.class] < CLASS_RANK[order.vehicle_class]) {
    return { ok: false, message: `Класс партнёра (${sub.class}) ниже класса заявки (${order.vehicle_class}).` };
  }

  // Стоимость по тарифу партнёра (costCents — явная переоценка логистом, иначе по прайсу)
  let cost: number;
  if (costCents != null && Number.isFinite(Number(costCents)) && Number(costCents) > 0) {
    cost = Math.round(Number(costCents));
  } else if (sub.price_mode === "per_km") {
    const kmRes = await db.execute({ sql: "SELECT distance_km FROM orders WHERE id = ?", args: [orderId] });
    const kmRow = kmRes.rows[0] as unknown as { distance_km: number } | undefined;
    cost = Math.round(Number(kmRow?.distance_km ?? 0) * sub.price_cents);
  } else {
    cost = sub.price_cents; // per_order / per_day
  }

  // Снять свою машину/водителей, если были назначены (партнёр replaces собственное назначение)
  await db.batch([
    { sql: "DELETE FROM assignments WHERE order_id = ?", args: [order.id] },
    { sql: "DELETE FROM trips WHERE order_id = ?", args: [order.id] },
    { sql: "INSERT INTO order_subcontractors (order_id, sub_id, cost_cents, move_date) VALUES (?, ?, ?, ?) ON CONFLICT(order_id) DO UPDATE SET sub_id = excluded.sub_id, cost_cents = excluded.cost_cents, move_date = excluded.move_date", args: [order.id, sub.id, cost, order.move_date] },
    { sql: "UPDATE orders SET status = 'assigned' WHERE id = ? AND status IN ('confirmed', 'assigned')", args: [order.id] },
  ], "write");

  await audit(db, user.id, "sub_assigned", "order", order.ref, `sub=${sub.name} cost=${(cost / 100).toFixed(2)}€ mode=${sub.price_mode}`);
  return { ok: true, message: `Заявка передана партнёру «${sub.name}» (стоимость ${(cost / 100).toFixed(2)} €).` };
}

export async function unassignSubcontractorAction(orderId: number): Promise<SimpleResult> {
  const db = await getDb();
  const user = await currentUser();
  if (!user || !["logist", "admin"].includes(user.role)) return { ok: false, message: "Недостаточно прав." };

  const orderRes = await db.execute({
    sql: "SELECT id, ref FROM orders WHERE id = ?",
    args: [orderId],
  });
  const order = orderRes.rows[0] as unknown as { id: number; ref: string } | undefined;
  if (!order) return { ok: false, message: "Заявка не найдена." };

  const delRes = await db.execute({
    sql: "DELETE FROM order_subcontractors WHERE order_id = ?",
    args: [order.id],
  });
  if (delRes.rowsAffected === 0) return { ok: false, message: "Партнёр не был назначен." };

  const updRes = await db.execute({
    sql: "UPDATE orders SET status = 'confirmed' WHERE id = ? AND status = 'assigned'",
    args: [order.id],
  });
  if (updRes.rowsAffected === 0) return { ok: false, message: "Статус заявки уже изменён." };

  await audit(db, user.id, "sub_unassigned", "order", order.ref);
  return { ok: true, message: "Партнёр снят — можно назначить свою машину." };
}
