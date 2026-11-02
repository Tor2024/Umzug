// Страница заявки /order/{ref} (Э3/D4.13): владелец (kunde) или logist/admin.

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { getDb, findSession, getTariffs, type SessionUser } from "@/lib/db";
import { recalculate, type QuoteSnapshot } from "@/lib/pricing";
import { tariffDrift } from "@/lib/ops";
import { AcceptanceButton } from "@/components/acceptance-button";
import RouteMapLazy from "@/components/route-map-lazy";
import { RevisionForm } from "@/components/revision-form";
import { RevisionDecision } from "@/components/revision-decision";
import { orderHistory, snapshotVersions } from "@/lib/db";
import { canRevise, hoursUntilMove, orderAgeHours, revisionFieldDiff, type OrderForRevision } from "@/lib/revision";
import { MessageThread, type MessageRow } from "./message-thread";

export const metadata: Metadata = { title: "Заявка", robots: { index: false } };
export const instant = false;

const STATUS_LABEL: Record<string, string> = {
  new: "Новая заявка",
  confirmed: "Подтверждена",
  assigned: "Машина назначена",
  enroute: "В пути",
  acceptance: "Приёмка",
  closed: "Закрыт",
  cancelled: "Отменён",
};

function fmt(cents: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso + "T12:00:00"));
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ msg?: string }> }) {
  await connection(); // Route uses DB time (Date.now in findSession/recalculate) — render at request time
  const { ref } = await params;
  const { msg } = await searchParams;
  const db = await getDb();
  const jar = await cookies();
  const user: SessionUser | null = await findSession(db, jar.get("ms_session")?.value ?? "");
  if (!user) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <p className="mb-4">Нужно войти, чтобы увидеть заявку.</p>
        <Link className="btn btn-primary" href={`/login?next=${encodeURIComponent(`/order/${ref}`)}`}>Войти</Link>
      </main>
    );
  }

  const orderRes = await db.execute({
    sql: "SELECT * FROM orders WHERE ref = ?",
    args: [ref.toUpperCase()],
  });
  const order = orderRes.rows[0] as unknown as
    | (Record<string, unknown> & { id: number; ref: string; client_id: number | null; status: string; snapshot: string; volume_m3: number; distance_km: number; move_date: string; from_text: string; to_text: string; pending_snapshot: string | null; revision_requested_by: string | null; start_time: string; self_pack: number; special_requests: string | null; special_approved: number | null })
    | undefined;
  if (!order) {
    return <main className="mx-auto max-w-xl px-4 py-10"><p>Заявка не найдена.</p></main>;
  }
  // Аудит #3: водитель, назначенный на рейс (trips), тоже видит заявку.
  let assignedDriver = false;
  if (user.role === "driver") {
    const tripRes = await db.execute({
      sql: "SELECT id FROM trips WHERE order_id = ? AND (driver_id = ? OR codriver_id = ?)",
      args: [order.id, user.id, user.id],
    });
    assignedDriver = !!tripRes.rows[0];
  }
  const canView = user.role === "logist" || user.role === "admin" || order.client_id === user.id || assignedDriver;
  if (!canView) {
    return <main className="mx-auto max-w-xl px-4 py-10"><p>Нет доступа к этой заявке.</p></main>;
  }
  // Аудит #2: логист/админ открыл заявку — клиентские сообщения прочитаны.
  if (user.role === "logist" || user.role === "admin") {
    const nowS = Math.floor(Date.parse(new Date().toISOString()) / 1000);
    await db.execute({
      sql: "UPDATE messages SET read_at = ? WHERE order_id = ? AND read_at IS NULL AND from_role <> ?",
      args: [nowS, order.id, user.role],
    });
  }

  const snap = JSON.parse(order.snapshot) as QuoteSnapshot;
  const tariffs = await getTariffs(db);
  const priceChanged = tariffDrift(snap, Number(order.gross_cents), tariffs); // D8.7: vs текущие тарифы
  const expired = snap.quoteValidUntil < new Date().toISOString().slice(0, 10);
  const linesRes = await db.execute({
    sql: "SELECT key, label, amount, meta FROM order_lines WHERE order_id = ? ORDER BY idx",
    args: [order.id],
  });
  const lines = linesRes.rows as unknown as
    Array<{ key: string; label: string; amount: number }>;
  // D6.7: UI-триггер приёмки — протокол есть + статус enroute + просмотр = владелец-kunde
  const protoRes = await db.execute({
    sql: "SELECT id FROM protocol WHERE order_id = ?",
    args: [order.id],
  });
  const proto = protoRes.rows[0];
  const showAcceptance = order.status === "enroute" && !!proto && user.role === "kunde" && order.client_id === user.id;
  // D7: счёт виден клиенту после закрытия заказа
  const invoiceRes = await db.execute({
    sql: "SELECT number, amount_cents, status, due_date, paid_at FROM invoices WHERE order_id = ?",
    args: [order.id],
  });
  const invoice = invoiceRes.rows[0] as unknown as
    | { number: string; amount_cents: number; status: string; due_date: string; paid_at: number | null }
    | undefined;
  let invoicePaid = 0;
  if (invoice) {
    const paidRes = await db.execute({
      sql: "SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE order_id = ?",
      args: [order.id],
    });
    invoicePaid = Number((paidRes.rows[0] as unknown as { s: number }).s);
  }
  // Геометрия маршрута для карты (Leaflet; null если заказ создан до Э8+ или маршрут без геометрии)
  const routeRes = await db.execute({
    sql: "SELECT geometry FROM route WHERE order_id = ?",
    args: [order.id],
  });
  const routeRow = routeRes.rows[0] as unknown as { geometry: string | null } | undefined;
  const geometry = routeRow?.geometry ? (JSON.parse(routeRow.geometry) as [number, number][]) : null;
  // D10: ревизия + история
  const revOrder = order as unknown as OrderForRevision;
  const isOwner = order.client_id === user.id;
  const revRole: "kunde" | "logist" | null = isOwner && user.role === "kunde" ? "kunde"
    : (user.role === "logist" || user.role === "admin") ? "logist" : null;
  const reviseGuard = revRole ? canRevise(revOrder, revRole) : { ok: false as const, reason: "" };
  const hoursLeft = Math.round(hoursUntilMove(order.move_date));
  const pendingSnap = order.pending_snapshot ? (JSON.parse(order.pending_snapshot) as QuoteSnapshot) : null;
  const history = await orderHistory(db, order.id);
  const versions = await snapshotVersions(db, order.id);
  // Задача 9: инбокс — последние сообщения по заявке
  const msgRes = await db.execute({
    sql: "SELECT id, from_role, from_email, body, created_at FROM messages WHERE order_id = ? ORDER BY created_at ASC LIMIT 100",
    args: [order.id],
  });
  const initialMessages = msgRes.rows as unknown as MessageRow[];
  // D11: карточка бригады после назначения (имена + машина, БЕЗ телефонов — PII)
  const crewRes = await db.execute({
    sql: `SELECT v.plate, v.label AS vehicle_label, du.name AS driver_name, cu.name AS codriver_name
     FROM assignments a
     JOIN vehicles v ON v.id = a.resource_id AND a.resource_type = 'vehicle'
     LEFT JOIN users du ON du.id = (SELECT resource_id FROM assignments WHERE order_id = a.order_id AND resource_type = 'driver' LIMIT 1)
     LEFT JOIN users cu ON cu.id = (SELECT resource_id FROM assignments WHERE order_id = a.order_id AND resource_type = 'driver' ORDER BY resource_id DESC LIMIT 1)
     WHERE a.order_id = ? AND a.resource_type = 'vehicle'`,
    args: [order.id],
  });
  const crewRow = crewRes.rows[0] as unknown as
    | { plate: string; vehicle_label: string; driver_name: string | null; codriver_name: string | null }
    | undefined;

  // UX-feedback: баннер результата действия, переживает router.replace(?msg=...) (D10/UX)
  const ORDER_MSG: Record<string, string> = {
    accepted: "Приёмка подтверждена. Логист получил заявку на закрытие.",
    revision_accepted: "Правка принята, цена обновлена.",
    revision_rejected: "Правка отклонена. Цена прежняя.",
    revision_proposed: "Изменение отправлено другой стороне. Ответ придёт здесь.",
    cancelled: "Заявка отменена.",
  };
  const orderMsg = msg ? ORDER_MSG[msg] : undefined;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="text-sm text-muted">Заявка</p>
      <h1 className="mb-4 text-2xl font-bold sm:text-3xl">{order.ref}</h1>
      <p className="mb-6 inline-block rounded-full bg-surface-2 px-3 py-1 text-sm">{STATUS_LABEL[order.status] ?? order.status}</p>

      {/* D11: бригада после назначения */}
      {crewRow && ["assigned", "enroute", "acceptance", "closed"].includes(order.status) && (
        <div className="mb-6 card p-5">
          <h2 className="mb-2 font-semibold">Ваша бригада</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Машина</dt><dd className="text-right">{crewRow.vehicle_label} · {crewRow.plate}</dd></div>
            <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Водитель</dt><dd>{crewRow.driver_name ?? "—"}</dd></div>
            {crewRow.codriver_name && crewRow.codriver_name !== crewRow.driver_name && (
              <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Второй водитель</dt><dd>{crewRow.codriver_name}</dd></div>
            )}
          </dl>
        </div>
      )}

      {/* D11: подсказка сроков правки */}
      {order.status === "new" && (
        <p className="mb-6 text-xs text-muted">
          До переезда {Math.max(0, Math.round(hoursLeft / 24))} дн. · правки возможны до {((): string => { const d = new Date(order.move_date + "T08:00:00Z"); d.setUTCHours(d.getUTCHours() - 72); return d.toISOString().slice(0, 10); })()} (72 ч до выезда).
        </p>
      )}

      {orderMsg && (
        <div className="mb-6 rounded-container border border-trust/40 bg-emerald-50 px-4 py-3 text-sm" role="status" aria-live="polite">
          {orderMsg}
        </div>
      )}

      {(priceChanged || expired) && (
        <div className="mb-6 rounded-container border border-accent-soft bg-orange-50 px-4 py-3 text-sm" role="status">
          Тарифы изменились или срок расчёта истёк ({snap.quoteValidUntil}). Требуется пересчёт — это сделает логист при подтверждении.
        </div>
      )}

      {showAcceptance && (
        <div className="mb-6 rounded-container border border-trust/40 bg-emerald-50 px-4 py-4" role="status">
          <p className="mb-3 font-semibold">Переезд завершён. Подтвердите, что всё в порядке.</p>
          <p className="mb-3 text-sm text-muted">
            Водитель составил протокол (факт загрузки, подпись). Ваше подтверждение переведёт заявку в статус «Приёмка»,
            после чего логист закроет заказ и будет выставлен счёт.
          </p>
          <AcceptanceButton orderId={order.id} />
        </div>
      )}

      <div className="card mb-6 p-5">
        <h2 className="mb-3 font-semibold">Маршрут и дата</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Откуда</dt><dd className="text-right">{order.from_text}</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Куда</dt><dd className="text-right">{order.to_text}</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Расстояние</dt><dd className="tabular-nums">{order.distance_km} км</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Дата</dt><dd>{dateLabel(order.move_date)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Объём</dt><dd className="tabular-nums">{order.volume_m3} м³</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Класс машины</dt><dd>{snap.config.vehicleClass}</dd></div>
          {order.start_time && <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Начало загрузки</dt><dd>{order.start_time}</dd></div>}
          {!!order.self_pack && <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Упаковка</dt><dd>Выполняется самостоятельно</dd></div>}
          {order.special_requests && (
            <div className="sm:col-span-2">
              <dt className="text-muted">Ваши доп. требования</dt>
              <dd className="mt-1 whitespace-pre-wrap">{order.special_requests}</dd>
              <dd className="mt-1 text-xs">
                {order.special_approved === 1 && <span className="text-trust">✓ Согласовано логистом</span>}
                {order.special_approved === 0 && <span className="text-danger">✕ Отклонено — мы свяжемся с вами в переписке</span>}
                {order.special_approved === null && <span className="text-muted">⏳ На согласовании у логиста</span>}
              </dd>
            </div>
          )}
        </dl>
        {geometry && <div className="mt-4"><RouteMapLazy geometry={geometry} fromText={order.from_text} toText={order.to_text} /></div>}
      </div>

      <div className="card mb-6 p-5">
        <h2 className="mb-3 font-semibold">Расчёт</h2>
        <dl className="grid gap-1.5 text-sm">
          {lines.map((l, i) => (
            <div key={`${l.key}-${i}`} className="flex justify-between gap-3">
              <dt className="text-muted">{l.label}</dt>
              <dd className="tabular-nums">{fmt(l.amount)}</dd>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
            <dt>Брутто</dt>
            <dd className="tabular-nums">{fmt(Number(order.gross_cents))}</dd>
          </div>
          <div className="flex justify-between text-muted">
            <dt>Аванс</dt>
            <dd className="tabular-nums">{fmt(Number(order.deposit_cents))}</dd>
          </div>
          <div className="flex justify-between text-muted">
            <dt>Остаток</dt>
            <dd className="tabular-nums">{fmt(Number(order.remainder_cents))}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs font-medium text-ink">Расчёт действителен до {dateLabel(snap.quoteValidUntil)}.</p>
      </div>

      {/* D10: активная правка — diff-карточка */}
      {pendingSnap && <PendingRevisionCard orderId={order.id} pendingSnapshot={order.pending_snapshot!} currentSnapshot={order.snapshot} requestedBy={order.revision_requested_by ?? ""} viewerRole={user.role} isOwner={isOwner} />}

      {/* D10: логист молчит — возраст заявки в new */}
      {order.status === "new" && (() => {
        const ageH = orderAgeHours({ created_at: Number(order.created_at) });
        if (ageH < 24) return null;
        return (
          <div className={`mb-6 rounded-container border px-4 py-3 text-sm ${ageH > 48 ? "border-accent-soft bg-orange-50" : "border-line bg-surface"}`} role="status">
            Заявка ждёт подтверждения логиста уже {Math.floor(ageH) > 48 ? <b>более 2 дней</b> : `${Math.floor(ageH)} ч`}.
            {ageH > 48 && " Вы можете отменить заявку и обратиться в другое время."}
          </div>
        );
      })()}

      {/* D10: форма правки (владелец или логист) */}
      {revRole && !pendingSnap && (order.status === "new" || order.status === "confirmed") && (
        <div className="card mb-6 p-5">
          <h2 className="mb-2 font-semibold">Корректировка заказа</h2>
          <RevisionForm
            orderId={order.id}
            role={revRole}
            canRevise={reviseGuard.ok}
            deadlineHint={reviseGuard.ok
              ? `Правки возможны ещё ~${Math.max(0, hoursLeft - (revRole === "kunde" ? 72 : 48)) < 0 ? "—" : Math.max(0, hoursLeft - (revRole === "kunde" ? 72 : 48)) >= 999 ? "—" : `${Math.max(0, hoursLeft - (revRole === "kunde" ? 72 : 48))} ч`} (порог ${revRole === "kunde" ? "72" : "48"} ч${Number(order.express) === 1 ? ", срочный: 24 ч" : ""}); до переезда ${hoursLeft} ч`
              : reviseGuard.reason}
            current={{
              volumeM3: snap.config.volumeM3, floorsFrom: snap.config.floorsFrom, floorsTo: snap.config.floorsTo,
              elevatorFrom: !!snap.config.elevatorFrom, elevatorTo: !!snap.config.elevatorTo,
              boxes: snap.config.boxes, kitchen: !!snap.config.kitchen, furnitureItems: snap.config.furnitureItems,
              packHours: snap.config.packHours, hvzZones: snap.config.hvzZones, extraCrew: snap.config.extraCrew,
              express: !!snap.config.express, sharedLoad: !!snap.config.sharedLoad,
            }}
          />
        </div>
      )}

      {/* D10: история заказа */}
      <div className="card mb-6 p-5">
        <h2 className="mb-3 font-semibold">История заказа</h2>
        {history.length === 0 && <p className="text-sm text-muted">Событий пока нет.</p>}
        <ul className="grid gap-2 text-sm">
          {history.map((h) => <HistoryEntry key={h.id} at={Number(h.at)} role={h.actor_role} action={h.action} details={h.details} />)}
        </ul>
        {versions.length > 1 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-accent">Предыдущие цены ({versions.length - 1})</summary>
            <ul className="mt-2 grid gap-1 text-sm">
              {versions.slice(1).map((v) => (
                <li key={v.version} className="flex justify-between border-b border-line py-1">
                  <span className="text-muted">Версия {v.version} · {dateLabel(new Date(Number(v.at) * 1000).toISOString().slice(0, 10))}</span>
                  <span className="tabular-nums">{fmt(Number(v.gross_cents))}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {invoice && (
        <div className="card mb-6 p-5">
          <h2 className="mb-3 font-semibold">Счёт {invoice.number}</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Сумма</dt><dd className="tabular-nums">{fmt(invoice.amount_cents)}</dd></div>
            <div><dt className="text-muted">Статус</dt><dd>
              {invoice.paid_at ? <span className="chip chip-trust">Оплачен</span>
                : invoice.status === "overdue" ? <span className="chip chip-delayed">Просрочен</span>
                : invoice.status === "cancelled" ? <span className="chip chip-neutral">Аннулирован</span>
                : <span className="chip chip-dispatched">Открыт</span>}
            </dd></div>
            <div><dt className="text-muted">Срок оплаты</dt><dd className="tabular-nums">{dateLabel(invoice.due_date)}</dd></div>
            <div><dt className="text-muted">Оплачено</dt><dd className="tabular-nums">{fmt(invoicePaid)}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-muted">Остаток к оплате: {fmt(Math.max(0, invoice.amount_cents - invoicePaid))}. Оплата — по реквизитам в счёте (демо).</p>
          <a className="btn btn-outline mt-3 inline-block px-3 py-1.5 text-sm" href={`/api/pdf/invoice/${invoice.number}`} target="_blank" rel="noopener">Скачать PDF</a>
        </div>
      )}

      {/* Инбокс — переписка клиента и персонала (задача 9) */}
      <MessageThread orderRef={order.ref} initial={initialMessages} viewerRole={user.role} />

      {/* Kostenvoranschlag — PDF расчёта (клиент/логист) */}
      <div className="mb-6">
        <a className="btn btn-outline px-3 py-1.5 text-sm" href={`/api/pdf/quote/${order.ref}`} target="_blank" rel="noopener">Kostenvoranschlag (PDF)</a>
      </div>

      <Link className="btn btn-outline" href="/account">В личный кабинет</Link>
    </main>
  );
}

// ─── D10: под-компоненты страницы заявки ─────────────────────────────────

/** Дифф-карточка активной правки (общий хелпер из lib/revision). */
function PendingRevisionCard({ orderId, pendingSnapshot, currentSnapshot, requestedBy, viewerRole, isOwner }: {
  orderId: number;
  pendingSnapshot: string;
  currentSnapshot: string;
  requestedBy: string;
  viewerRole: string;
  isOwner: boolean;
}) {
  const pending = JSON.parse(pendingSnapshot) as QuoteSnapshot;
  const current = JSON.parse(currentSnapshot) as QuoteSnapshot;
  const pendingQuote = recalculate(pending);
  const currentGross = recalculate(current).gross;
  const diff = revisionFieldDiff(current, pending);
  const decider = requestedBy === "logist" ? "клиент" : "логист";
  const canDecide = (requestedBy === "logist" && isOwner && viewerRole === "kunde")
    || (requestedBy === "kunde" && (viewerRole === "logist" || viewerRole === "admin"));

  return (
    <div className="mb-6 rounded-container border border-accent-soft bg-orange-50 p-5">
      <h2 className="font-semibold">
        {requestedBy === "logist" ? "Логист предложил изменение" : "Клиент запросил изменение"} — ждёт подтверждения ({decider})
      </h2>
      {diff.length > 0 && (
        <dl className="mt-3 grid gap-1 text-sm">
          {diff.map((d) => (
            <div key={d.label} className="flex justify-between">
              <dt className="text-muted">{d.label}</dt>
              <dd>
                <span className="text-muted line-through">{d.from}</span>
                <span className="mx-1">→</span>
                <b>{d.to}</b>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <dl className="mt-3 grid gap-1 border-t border-line pt-2 text-sm">
        <div className="flex justify-between">
          <dt>Цена (брутто)</dt>
          <dd className="tabular-nums">
            <span className="text-muted line-through">{fmt(currentGross)}</span>
            <span className="mx-1">→</span>
            <b>{fmt(pendingQuote.gross)}</b>
          </dd>
        </div>
        <div className="flex justify-between text-muted"><dt>Аванс 30 % (новый)</dt><dd className="tabular-nums">{fmt(pendingQuote.deposit)}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-muted">Расчёт по текущим тарифам; действителен до {dateLabel(pending.quoteValidUntil)}.</p>
      {canDecide && <div className="mt-3"><RevisionDecision orderId={orderId} kind="accept" /></div>}
      {!canDecide && <p className="mt-3 text-sm text-muted">Решение за {decider === "клиент" ? "клиентом" : "логистом"}.</p>}
    </div>
  );
}

/** Человекочитаемая строка события истории. */
const ACTION_TEXT: Record<string, string> = {
  order_created: "Заявка создана",
  revision_proposed: "Предложена правка",
  revision_accepted: "Правка принята — цена обновлена",
  revision_rejected: "Правка отклонена",
  status_changed: "Статус изменён",
  cancelled: "Заявка отменена",
};
const ROLE_TEXT: Record<string, string> = { kunde: "Клиент", logist: "Логист", driver: "Водитель", finance: "Бухгалтерия", admin: "Админ" };

function HistoryEntry({ at, role, action, details }: { at: number; role: string; action: string; details: string }) {
  const d = (() => { try { return JSON.parse(details) as Record<string, unknown>; } catch { return {}; } })();
  let text = ACTION_TEXT[action] ?? action;
  if (action === "revision_proposed" && d.fields) {
    const fields = d.fields as Record<string, { from: unknown; to: unknown }>;
    const parts = Object.entries(fields).map(([k, v]) => `${FIELD_TEXT[k] ?? k}: ${String(v.from)} → ${String(v.to)}`);
    if (parts.length > 0) text += ` (${parts.join(", ")})`;
    if (typeof d.new_gross === "number") text += ` — новая цена ${fmt(d.new_gross)}`;
  }
  if (action === "revision_accepted" && typeof d.from_gross === "number" && typeof d.to_gross === "number") {
    text += `: ${fmt(d.from_gross)} → ${fmt(d.to_gross)}`;
  }
  if (action === "status_changed" && typeof d.to === "string") text += `: ${d.to}`;
  const label = new Date(at * 1000).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <li className="border-b border-line pb-2">
      <span className="text-muted">{label} · {ROLE_TEXT[role] ?? role}</span>
      <span className="ml-2">{text}</span>
    </li>
  );
}

const FIELD_TEXT: Record<string, string> = {
  volumeM3: "объём", floorsFrom: "этаж (откуда)", floorsTo: "этаж (куда)",
  boxes: "коробки", kitchen: "кухня", hvzZones: "HVZ", extraCrew: "грузчики",
  packHours: "упаковка, ч", furnitureItems: "мебель", elevatorFrom: "лифт (откуда)",
  elevatorTo: "лифт (куда)", express: "срочный", sharedLoad: "догруз",
};
