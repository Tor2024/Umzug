// D10: двусторонняя корректировка заказа (правки только в new/confirmed; дедлайны; снимки версий).
// Основной snapshot immutable: правки живут в orders.pending_snapshot до подтверждения другой стороной.

import type { DB } from "./db";
import { getTariffs } from "./db";
import { calculateQuote, makeSnapshot, validateConfig, type MoveConfig, type QuoteSnapshot } from "./pricing";

// ─── D10-visibility: diff полей между снимками ───────────────────────────

const REVISION_FIELDS: Array<{ key: string; label: string; fmtVal: (v: unknown) => string }> = [
  { key: "volumeM3", label: "Объём", fmtVal: (v) => `${String(v).replace(".", ",")} м³` },
  { key: "floorsFrom", label: "Этаж (откуда)", fmtVal: (v) => (v === 0 ? "улица" : `${v}-й`) },
  { key: "floorsTo", label: "Этаж (куда)", fmtVal: (v) => (v === 0 ? "улица" : `${v}-й`) },
  { key: "boxes", label: "Коробки", fmtVal: (v) => String(v) },
  { key: "kitchen", label: "Кухня", fmtVal: (v) => (v ? "да" : "нет") },
  { key: "hvzZones", label: "HVZ-зоны", fmtVal: (v) => String(v) },
  { key: "extraCrew", label: "Доп. грузчики", fmtVal: (v) => `+${String(v)}` },
  { key: "packHours", label: "Упаковка", fmtVal: (v) => `${String(v)} ч` },
  { key: "furnitureItems", label: "Мебель", fmtVal: (v) => String(v) },
  { key: "elevatorFrom", label: "Лифт (откуда)", fmtVal: (v) => (v ? "да" : "нет") },
  { key: "elevatorTo", label: "Лифт (куда)", fmtVal: (v) => (v ? "да" : "нет") },
  { key: "express", label: "Срочный", fmtVal: (v) => (v ? "да" : "нет") },
  { key: "sharedLoad", label: "Догруз", fmtVal: (v) => (v ? "да" : "нет") },
];

/** Хелпер diff двух снимков (используется на /order и /dispatch). */
export function revisionFieldDiff(current: QuoteSnapshot, pending: QuoteSnapshot): Array<{ label: string; from: string; to: string }> {
  const out: Array<{ label: string; from: string; to: string }> = [];
  for (const f of REVISION_FIELDS) {
    const a = (current.config as unknown as Record<string, unknown>)[f.key];
    const b = (pending.config as unknown as Record<string, unknown>)[f.key];
    if (a !== b) out.push({ label: f.label, from: f.fmtVal(a), to: f.fmtVal(b) });
  }
  return out;
}

// Дедлайны (критик 2): клиент 72 ч / логист 48 ч до переезда; express (<48 ч от заявки до переезда) — 24 ч обеим.
// Якорь — 08:00 Europe/Berlin (не UTC-полночь, иначе заказ «на завтра вечером» получает отрицательный запас).
export const CLIENT_CUTOFF_H = 72;
export const LOGIST_CUTOFF_H = 48;
export const EXPRESS_CUTOFF_H = 24;
export const EXPRESS_WINDOW_H = 48;

export interface OrderForRevision {
  id: number;
  ref: string;
  status: string;
  client_id: number | null;
  pending_snapshot: string | null;
  revision_requested_by: string | null;
  move_date: string;
  created_at: number;
  snapshot: string;
  express: number;
}

/** Возраст заявки в часах (для «логист молчит» — display-only, D10.5). */
export function orderAgeHours(order: { created_at: number }): number {
  return (Date.now() / 1000 - order.created_at) / 3600;
}

/** Часы до 08:00 Europe/Berlin в день move_date (отрицательные = уже прошло). */
export function hoursUntilMove(moveDateIso: string, now = new Date()): number {
  const move = new Date(`${moveDateIso}T08:00:00Z`);
  const offsetH = berlinOffsetHours(move);
  const moveUtc = new Date(move.getTime() - offsetH * 3600_000); // 08:00 Berlin в UTC-метках
  return (moveUtc.getTime() - now.getTime()) / 3600_000;
}

function berlinOffsetHours(d: Date): number {
  const year = d.getUTCFullYear();
  const dstStart = lastSundayOfMonth(year, 2); // март (0-based)
  const dstEnd = lastSundayOfMonth(year, 9);   // октябрь
  const t = d.getTime();
  return t >= dstStart && t < dstEnd ? 2 : 1;
}

function lastSundayOfMonth(year: number, month0: number): number {
  const d = new Date(Date.UTC(year, month0 + 1, 0, 3, 0, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}

/** Гвард правки (D10.3): статус + дедлайн. Вызывается в propose/request экшенах. */
export function canRevise(order: OrderForRevision, role: "kunde" | "logist"): { ok: true } | { ok: false; reason: string } {
  if (order.pending_snapshot) return { ok: false, reason: "У заказа уже есть активная правка — дождитесь её подтверждения или отклонения." };
  if (order.status !== "new" && order.status !== "confirmed") {
    return { ok: false, reason: "Правки возможны только до назначения машины (после — только отмена)." };
  }
  const hoursLeft = hoursUntilMove(order.move_date);
  const isExpress = order.express === 1;
  const cutoff = role === "kunde"
    ? (isExpress ? EXPRESS_CUTOFF_H : CLIENT_CUTOFF_H)
    : (isExpress ? EXPRESS_CUTOFF_H : LOGIST_CUTOFF_H);
  if (hoursLeft < cutoff) {
    return {
      ok: false,
      reason: `Слишком поздно для правок: до переезда ${Math.max(0, Math.round(hoursLeft))} ч, порог ${cutoff} ч${isExpress ? " (срочный заказ)" : ""}. Только отмена.`,
    };
  }
  return { ok: true };
}

/**
 * Серверный пересчёт правки (критик 2: клиент не вводит цены — патч параметров, сервер считает).
 * Возвращает новый QuoteSnapshot (со свежим quoteValidUntil) или причину отказа.
 */
export async function buildRevisionSnapshot(
  db: import("./db").DB,
  order: OrderForRevision,
  patch: Partial<MoveConfig>,
  role: "kunde" | "logist",
): Promise<{ ok: true; snapshot: QuoteSnapshot; quote: ReturnType<typeof calculateQuote> } | { ok: false; reason: string }> {
  const guard = canRevise(order, role);
  if (!guard.ok) return { ok: false, reason: guard.reason };

  const snap = JSON.parse(order.snapshot) as QuoteSnapshot;
  const cfg: MoveConfig = { ...snap.config, ...patch };
  try {
    validateConfig(cfg);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Некорректные параметры." };
  }
  const tariffs = await getTariffs(db); // перерасчёт по ТЕКУЩИМ тарифам из БД
  const quote = calculateQuote(cfg, tariffs);
  const newSnap = makeSnapshot(cfg, tariffs);
  return { ok: true, snapshot: newSnap, quote };
}
