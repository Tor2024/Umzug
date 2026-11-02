import { connection } from "next/server";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getDb, CONFIG_SCHEMA } from "@/lib/db";
import {
  updateTariffsAction,
  updateVehicleClassAction,
  updateStaffUserAction,
  saveVehicleAction,
  deleteVehicleAction,
  updateApiKeyAction,
  type TariffBatchResult,
  type SimpleResult,
} from "@/lib/actions";
import { verifyChain, listAllOrderHistory } from "@/lib/db";
import { SubmitButton } from "@/components/submit-button";
import type { Metadata } from "next";

export const instant = false;
export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Админ-панель" };

// Русские подписи тарифных ключей (D8.9: company.name не редактируется)
const KEY_LABELS: Record<string, string> = {
  "pricing.crew_hourly_cents": "Ставка грузчика, €/ч (центы)",
  "pricing.crew_count": "Грузчиков в экипаже",
  "pricing.hours_per_m3": "Часов погрузки на м³ (×100)",
  "pricing.min_crew_hours": "Мин. часы экипажа",
  "pricing.per_km_cents": "Цена за км, центы",
  "pricing.free_km": "Бесплатные км",
  "pricing.avg_speed_kmh": "Средняя скорость, км/ч",
  "pricing.floor_cents": "Этаж (за этаж), центы",
  "pricing.elevator_cents": "Лифт (замена этажей), центы",
  "pricing.extra_m3_cents": "Доп. м³ сверх включённого, центы",
  "pricing.box_cents": "Коробка, центы",
  "pricing.pack_hourly_cents": "Упаковка, €/ч (центы)",
  "pricing.kitchen_cents": "Сборка кухни, центы",
  "pricing.furniture_cents": "Мебель (за предмет), центы",
  "pricing.hvz_zone_cents": "Зона HFZ, центы",
  "pricing.vat_pct": "НДС, %",
  "pricing.vat_enabled": "НДС включён (1/0)",
  "pricing.deposit_pct": "Аванс, %",
  "pricing.weekend_pct": "Выходной (сб/праздник), %",
  "pricing.express_pct": "Срочный (48 ч), %",
  "pricing.shared_load_pct": "Догруз, % (скидка)",
  "pricing.season_pct": "Сезонный коэффициент, %",
  "pricing.load_pct": "Коэф. загрузки, %",
  "pricing.quote_valid_days": "Смета действительна, дней",
  "finance.due_days": "Срок оплаты счёта, дней",
};

type ClassRow = { class: string; label: string; capacity_m3: number; included_m3: number; base_cents: number; active: number };
type UserRow = { id: number; email: string; name: string; role: string; active: number; email_verified: number };
type VehicleRow = { id: number; plate: string; class: string; label: string; capacity_m3: number; active: number };
type AuditRow = { id: number; at: number; user_id: number; action: string; entity: string; entity_id: string; details: string };

const ROLES = ["kunde", "logist", "driver", "finance", "admin"] as const;

const HISTORY_ROLE: Record<string, string> = { kunde: "Клиент", logist: "Логист", driver: "Водитель", finance: "Бухгалтерия", admin: "Админ", system: "Система" };
/** Человекочитаемые детали события (кратко; полные JSON — в audit). */
function historyDetails(action: string, details: string): string {
  try {
    const d = JSON.parse(details) as Record<string, unknown>;
    if (action === "revision_accepted" && typeof d.from_gross === "number" && typeof d.to_gross === "number") {
      return `${(d.from_gross / 100).toFixed(2)} € → ${(d.to_gross / 100).toFixed(2)} €`;
    }
    if (action === "revision_rejected" && typeof d.rejected_gross === "number") {
      return `отклонена цена ${(d.rejected_gross / 100).toFixed(2)} €`;
    }
    if (action === "revision_proposed" && typeof d.new_gross === "number" && typeof d.old_gross === "number") {
      const fields = d.fields as Record<string, { from: unknown; to: unknown }> | undefined;
      const names = fields ? Object.keys(fields).join(", ") : "";
      return `${names}: ${(d.old_gross / 100).toFixed(2)} → ${(d.new_gross / 100).toFixed(2)} €`;
    }
    if (action === "status_changed" && typeof d.from === "string" && typeof d.to === "string") {
      return `${d.from} → ${d.to}`;
    }
    if (action === "cancelled" && typeof d.from_status === "string") return `из ${d.from_status}`;
    return Object.entries(d).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" ");
  } catch {
    return details;
  }
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await connection();
  await requireRole(["admin"], "/admin");
  const db = await getDb();
  const { msg } = await searchParams;

  // Локальные server-action-обёртки (FormData → экшены)
  async function tariffsForm(fd: FormData): Promise<void> {
    "use server";
    const values: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("cfg_") && typeof v === "string") values[k.slice(4)] = v;
    const r: TariffBatchResult = await updateTariffsAction(values);
    const { redirect } = await import("next/navigation");
    redirect(`/admin?msg=${r.ok ? "tariffs" : "error"}`);
  }
  async function classForm(fd: FormData): Promise<void> {
    "use server";
    const r = await updateVehicleClassAction({
      cls: String(fd.get("cls") ?? ""),
      label: String(fd.get("label") ?? ""),
      capacityM3: Number(String(fd.get("capacity") ?? "0").replace(",", ".")),
      includedM3: Number(String(fd.get("included") ?? "0").replace(",", ".")),
      baseCents: Math.round(Number(String(fd.get("base") ?? "0").replace(",", ".")) * 100),
      active: fd.get("active") === "on",
    });
    const { redirect } = await import("next/navigation");
    redirect(`/admin?msg=${r.ok ? "class" : "error"}`);
  }
  async function userForm(fd: FormData): Promise<void> {
    "use server";
    const pw = String(fd.get("newPassword") ?? "");
    const r = await updateStaffUserAction({
      userId: Number(fd.get("userId")),
      role: String(fd.get("role") ?? "") || undefined,
      active: fd.get("active") === "on",
      newPassword: pw || undefined,
    });
    const { redirect } = await import("next/navigation");
    redirect(`/admin?msg=${r.ok ? "user" : "error"}`);
  }
  async function vehicleForm(fd: FormData): Promise<void> {
    "use server";
    const vid = Number(fd.get("vehicleId") ?? 0);
    const r: SimpleResult = await saveVehicleAction({
      vehicleId: vid || undefined,
      plate: String(fd.get("plate") ?? ""),
      cls: String(fd.get("cls") ?? "A"),
      label: String(fd.get("label") ?? ""),
      active: fd.get("active") === "on",
    });
    const { redirect } = await import("next/navigation");
    redirect(`/admin?msg=${r.ok ? "vehicle" : "error"}`);
  }
  async function vehicleDeleteForm(fd: FormData): Promise<void> {
    "use server";
    const r = await deleteVehicleAction(Number(fd.get("vehicleId")));
    const { redirect } = await import("next/navigation");
    redirect(`/admin?msg=${r.ok ? "vehicleDel" : r.message?.includes("нельзя") ? "vehicleBusy" : "error"}`);
  }
  async function apiKeyForm(fd: FormData): Promise<void> {
    "use server";
    const r = await updateApiKeyAction(String(fd.get("apiKey") ?? ""));
    const { redirect } = await import("next/navigation");
    redirect(`/admin?msg=${r.ok ? "apikey" : "error"}`);
  }

  const configRowsRes = await db.execute("SELECT key, value FROM config");
  const configRows = configRowsRes.rows as unknown as { key: string; value: string }[];
  const configMap = new Map(configRows.map((r) => [r.key, r.value]));
  const tariffKeys = Object.keys(CONFIG_SCHEMA).filter((k) => k.startsWith("pricing.") || k === "finance.due_days");
  const classesRes = await db.execute("SELECT * FROM vehicle_classes ORDER BY class");
  const classes = classesRes.rows as unknown as ClassRow[];
  const usersRes = await db.execute("SELECT id, email, name, role, active, email_verified FROM users ORDER BY role, id");
  const users = usersRes.rows as unknown as UserRow[];
  const vehiclesRes = await db.execute("SELECT id, plate, class, label, capacity_m3, active FROM vehicles ORDER BY id");
  const vehicles = vehiclesRes.rows as unknown as VehicleRow[];
  const auditRowsRes = await db.execute("SELECT * FROM audit ORDER BY id DESC LIMIT 50");
  const auditRows = auditRowsRes.rows as unknown as AuditRow[];
  const historyRows = await listAllOrderHistory(db, 100);
  const chain = await verifyChain(db);
  const apiKeySet = !!configMap.get("maps.api_key");

  const MSG: Record<string, { text: string; ok: boolean }> = {
    tariffs: { text: "Тарифы сохранены.", ok: true },
    class: { text: "Класс обновлён.", ok: true },
    user: { text: "Пользователь обновлён.", ok: true },
    vehicle: { text: "Машина сохранена.", ok: true },
    vehicleDel: { text: "Машина удалена.", ok: true },
    vehicleBusy: { text: "Удаление отклонено: есть рейсы/назначения.", ok: false },
    apikey: { text: "API-ключ сохранён.", ok: true },
    error: { text: "Не сохранилось — проверьте выделенные значения.", ok: false },
  };
  const banner = msg ? MSG[msg] : undefined;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">Админ-панель</h1>
      <p className="mt-1 text-sm text-muted">
        <Link className="text-accent underline" href="/analytics">Аналитика →</Link>
        {" · "}
        <Link className="text-accent underline" href="/inbox">Инбокс →</Link>
      </p>
      {banner && (
        <div role="status" className={`mt-4 rounded-base border px-4 py-3 text-sm ${banner.ok ? "border-trust/30 bg-emerald-50 text-emerald-900" : "border-danger/30 bg-red-50 text-red-900"}`}>
          {banner.text}
        </div>
      )}

      {/* ── Тарифы (D8.1: один submit, батч в транзакции) ── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Тарифы и коэффициенты</h2>
        <p className="mt-1 text-sm text-muted">Изменения влияют только на новые расчёты; существующие заказы защищены снимком.</p>
        <form action={tariffsForm} className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tariffKeys.map((k) => {
              const s = CONFIG_SCHEMA[k];
              const val = configMap.get(k) ?? "";
              const isBool = s.type === "bool";
              return (
                <label key={k} className="block text-sm">
                  <span className="text-muted">{KEY_LABELS[k] ?? k}</span>
                  {isBool ? (
                    <select name={`cfg_${k}`} defaultValue={val} className={`input-base mt-1 ${val === "1" ? "" : ""}`}>
                      <option value="1">Включён</option>
                      <option value="0">Выключен</option>
                    </select>
                  ) : (
                    <input name={`cfg_${k}`} defaultValue={val} inputMode="decimal" className="input-base mt-1" />
                  )}
                </label>
              );
            })}
          </div>
          <SubmitButton className="btn btn-primary mt-4">Сохранить тарифы</SubmitButton>
        </form>
      </section>

      {/* ── Классы машин (D8.4) ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Классы машин</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {classes.map((c) => (
            <form key={c.class} action={classForm} className="card p-4">
              <input type="hidden" name="cls" value={c.class} />
              <div className="font-medium">Класс {c.class}</div>
              <label className="mt-2 block text-sm">
                <span className="text-muted">Название</span>
                <input name="label" defaultValue={c.label} className="input-base mt-1" />
              </label>
              <label className="mt-2 block text-sm">
                <span className="text-muted">Вместимость, м³</span>
                <input name="capacity" defaultValue={c.capacity_m3} inputMode="numeric" className="input-base mt-1" />
              </label>
              <label className="mt-2 block text-sm">
                <span className="text-muted">Включённый объём, м³</span>
                <input name="included" defaultValue={c.included_m3} inputMode="numeric" className="input-base mt-1" />
              </label>
              <label className="mt-2 block text-sm">
                <span className="text-muted">База, €</span>
                <input name="base" defaultValue={(c.base_cents / 100).toString()} inputMode="decimal" className="input-base mt-1" />
              </label>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={c.active === 1} className="size-4" />
                Активен (предлагается новым заказам)
              </label>
              <SubmitButton className="btn btn-secondary mt-3 w-full">Сохранить</SubmitButton>
            </form>
          ))}
        </div>
      </section>

      {/* ── Пользователи (D8.2/D8.3) ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Пользователи</h2>
        <div className="mt-4 space-y-3">
          {users.map((u) => (
            <form key={u.id} action={userForm} className="card flex flex-wrap items-end gap-3 p-4">
              <input type="hidden" name="userId" value={u.id} />
              <div className="min-w-48 flex-1">
                <div className="font-medium">{u.name}</div>
                <div className="text-sm text-muted">{u.email}{u.email_verified ? "" : " · не подтверждён"}</div>
              </div>
              <label className="text-sm">
                <span className="text-muted">Роль</span>
                <select name="role" defaultValue={u.role} className="input-base mt-1 w-32">
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={u.active === 1} className="size-4" />
                Активен
              </label>
              <label className="text-sm">
                <span className="text-muted">Новый пароль</span>
                <input name="newPassword" type="password" placeholder="— не менять —" className="input-base mt-1 w-40" />
              </label>
              <SubmitButton className="btn btn-secondary">Сохранить</SubmitButton>
            </form>
          ))}
        </div>
      </section>

      {/* ── Парк машин (D8.6) ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Парк машин</h2>
        <div className="mt-4 space-y-3">
          {vehicles.map((v) => (
            <div key={v.id} className="card p-4">
              <form action={vehicleForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="vehicleId" value={v.id} />
                <label className="text-sm">
                  <span className="text-muted">Номер</span>
                  <input name="plate" defaultValue={v.plate} className="input-base mt-1 w-32" />
                </label>
                <label className="text-sm">
                  <span className="text-muted">Класс</span>
                  <select name="cls" defaultValue={v.class} className="input-base mt-1 w-20">
                    {classes.filter((c) => c.active === 1).map((c) => <option key={c.class} value={c.class}>{c.class}</option>)}
                  </select>
                </label>
                <label className="min-w-40 flex-1 text-sm">
                  <span className="text-muted">Название</span>
                  <input name="label" defaultValue={v.label} className="input-base mt-1" />
                </label>
                <div className="text-sm text-muted">вместимость: {v.capacity_m3} м³ (из класса)</div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={v.active === 1} className="size-4" />
                  Активна
                </label>
                <SubmitButton className="btn btn-secondary">Сохранить</SubmitButton>
              </form>
              <form action={vehicleDeleteForm} className="mt-2">
                <input type="hidden" name="vehicleId" value={v.id} />
                <button type="submit" className="text-sm text-danger hover:underline">Удалить (если нет рейсов)</button>
              </form>
            </div>
          ))}
          {/* Новая машина */}
          <form action={vehicleForm} className="card flex flex-wrap items-end gap-3 border-dashed p-4">
            <label className="text-sm">
              <span className="text-muted">Номер</span>
              <input name="plate" placeholder="B-MA 5005" className="input-base mt-1 w-32" />
            </label>
            <label className="text-sm">
              <span className="text-muted">Класс</span>
              <select name="cls" defaultValue="A" className="input-base mt-1 w-20">
                {classes.filter((c) => c.active === 1).map((c) => <option key={c.class} value={c.class}>{c.class}</option>)}
              </select>
            </label>
            <label className="min-w-40 flex-1 text-sm">
              <span className="text-muted">Название</span>
              <input name="label" placeholder="Transporter 3,5 т" className="input-base mt-1" />
            </label>
            <input type="hidden" name="active" value="on" />
            <SubmitButton className="btn btn-primary">Добавить машину</SubmitButton>
          </form>
        </div>
      </section>

      {/* ── maps.api_key (D8.5) ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Google Maps API-ключ</h2>
        <p className="mt-1 text-sm text-muted">
          Статус: {apiKeySet ? <span className="text-trust">установлен</span> : <span className="text-muted">не установлен (используется OSRM/OSM)</span>}.
          Ключ не отображается; пустой ввод = не менять. Пока ключа нет, расчёт маршрута идёт через OSRM/OSM с тем же интерфейсом.
        </p>
        <form action={apiKeyForm} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="text-muted">Новый ключ (Google Distance Matrix + Geocoding)</span>
            <input name="apiKey" type="password" placeholder="— не менять —" className="input-base mt-1 w-80" />
          </label>
          <SubmitButton className="btn btn-secondary">Сохранить ключ</SubmitButton>
        </form>
      </section>

      {/* ── История изменений заказов (D10, полная — вкл. client_visible=0) ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">История изменений заказов (100 последних)</h2>
        <p className="mt-1 text-sm text-muted">
          Все операции по каждому заказу: создание, правки цены (со значениями старое → новое), решения сторон,
          смены статусов, отмена. Клиент на своей странице видит только открытую часть (без служебных деталей).
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-2">Когда</th><th>Заказ</th><th>Роль</th><th>Событие</th><th>Детали</th>
            </tr>
          </thead>
          <tbody>
            {historyRows.map((h) => (
              <tr key={h.id} className="border-t border-line">
                <td className="py-2 whitespace-nowrap">{new Date(h.at * 1000).toLocaleString("ru-RU")}</td>
                <td>
                  <Link className="text-accent hover:underline" href={`/order/${h.ref}`}>{h.ref}</Link>
                  {!h.client_visible && <span className="ml-1 chip chip-neutral">служебное</span>}
                </td>
                <td>{HISTORY_ROLE[h.actor_role] ?? h.actor_role}</td>
                <td className="font-mono text-xs">{h.action}</td>
                <td className="text-xs text-muted">{historyDetails(h.action, h.details)}</td>
              </tr>
            ))}
            {historyRows.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-center text-muted">Событий пока нет.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ── Аудит ── */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Журнал аудита (50 последних)</h2>
          <span className={`chip ${chain.valid ? "chip-trust" : "chip-delayed"}`}>
            Цепочка протоколов: {chain.valid ? "валидна" : "НАРУШЕНА"} · {chain.count}
          </span>
        </div>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-2">Когда</th><th>Кто (id)</th><th>Действие</th><th>Объект</th><th>Детали</th>
            </tr>
          </thead>
          <tbody>
            {auditRows.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="py-2 whitespace-nowrap">{new Date(a.at * 1000).toLocaleString("ru-RU")}</td>
                <td>{a.user_id}</td>
                <td className="font-mono text-xs">{a.action}</td>
                <td className="font-mono text-xs">{a.entity}{a.entity_id ? `:${a.entity_id}` : ""}</td>
                <td className="text-xs text-muted">{a.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="mt-8 text-xs text-muted">
        Демо-среда: изменения тарифов влияют только на новые заказы; существующие защищены снимком цены.
      </p>
    </div>
  );
}
