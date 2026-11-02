import { connection } from "next/server";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getDb, CONFIG_SCHEMA } from "@/lib/db";
import {
  updateTariffsAction,
  updateVehicleClassAction,
  updateStaffUserAction,
  createStaffUserAction,
  saveVehicleAction,
  deleteVehicleAction,
  returnVehicleAction,
  updateApiKeyAction,
  createSubcontractorAction,
  toggleSubcontractorAction,
  bindDriverVehicleAction,
  type TariffBatchResult,
  type SimpleResult,
} from "@/lib/actions";
import { verifyChain, listAllOrderHistory } from "@/lib/db";
import { SubmitButton } from "@/components/submit-button";
import type { Metadata } from "next";

export const instant = false;
export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Adminbereich" };

// Deutsche Bezeichnungen der Tarif-Schlüssel (D8.9: company.name wird nicht editiert)
const KEY_LABELS: Record<string, string> = {
  "pricing.crew_hourly_cents": "Träger-Stundensatz, €/Std. (Cent)",
  "pricing.crew_count": "Träger pro Crew",
  "pricing.hours_per_m3": "Beladestunden pro m³ (×100)",
  "pricing.min_crew_hours": "Min. Crew-Stunden",
  "pricing.per_km_cents": "Preis pro km, Cent",
  "pricing.free_km": "Kostenlose km",
  "pricing.avg_speed_kmh": "Durchschnittsgeschwindigkeit, km/h",
  "pricing.floor_cents": "Etage (pro Etage), Cent",
  "pricing.elevator_cents": "Aufzug (ersetzt Etagen), Cent",
  "pricing.extra_m3_cents": "Zusatz-m³ über inkludiertem, Cent",
  "pricing.box_cents": "Karton, Cent",
  "pricing.pack_hourly_cents": "Verpackungsservice, €/Std. (Cent)",
  "pricing.kitchen_cents": "Küchenmontage, Cent",
  "pricing.furniture_cents": "Möbel (pro Stück), Cent",
  "pricing.hvz_zone_cents": "HFZ-Zone, Cent",
  "pricing.vat_pct": "MwSt., %",
  "pricing.vat_enabled": "MwSt. inklusive (1/0)",
  "pricing.deposit_pct": "Anzahlung, %",
  "pricing.weekend_pct": "Wochenende (Sa/Feiertag), %",
  "pricing.express_pct": "Eilig (48 Std.), %",
  "pricing.shared_load_pct": "Beiladung, % (Rabatt)",
  "pricing.season_pct": "Saisonfaktor, %",
  "pricing.load_pct": "Auslastungsfaktor, %",
  "pricing.quote_valid_days": "Angebot gültig, Tage",
  "finance.due_days": "Zahlungsziel der Rechnung, Tage",
};

type ClassRow = { class: string; label: string; capacity_m3: number; included_m3: number; base_cents: number; active: number };
type UserRow = { id: number; email: string; name: string; role: string; active: number; email_verified: number; driver_vehicle_id?: number | null };
type VehicleRow = { id: number; plate: string; class: string; label: string; capacity_m3: number; active: number; home_base: string; current_location: string };
type SubRow = { id: number; name: string; contact: string; phone: string; email: string; class: string; price_mode: string; price_cents: number; notes: string; active: number };
type AuditRow = { id: number; at: number; user_id: number; action: string; entity: string; entity_id: string; details: string };

const ROLES = ["kunde", "logist", "driver", "finance", "admin"] as const;
const ROLE_RU: Record<string, string> = { kunde: "Kunde", logist: "Disponent", driver: "Fahrer", finance: "Buchhaltung", admin: "Admin" };

const HISTORY_ROLE: Record<string, string> = { kunde: "Kunde", logist: "Disponent", driver: "Fahrer", finance: "Buchhaltung", admin: "Admin", system: "System" };

/** Lesbare Bezeichnung der Auftrags-Historie-Ereignisse (statt technischer Action-Codes). */
const HISTORY_ACTION: Record<string, string> = {
  order_created: "Anfrage erstellt",
  status_changed: "Status geändert",
  cancelled: "Anfrage storniert",
  revision_proposed: "Preisänderung vorgeschlagen",
  revision_accepted: "Preisänderung akzeptiert",
  revision_rejected: "Preisänderung abgelehnt",
  auto_assigned: "Automatisch zugewiesen",
  protocol_signed: "Abnahmeprotokoll unterschrieben",
  reminder_deposit: "Anzahlungserinnerung",
  reminder_invoice: "Rechnungserinnerung",
  driver_morning_email: "Morgenmail an den Fahrer",
  traffic_delay: "Verspätungswarnung",
  checkpoint_departed: "Crew losgefahren",
  checkpoint_arrived_load: "An der Ladestelle",
  checkpoint_loaded: "Gut beladen",
  checkpoint_arrived_unload: "An der Entladestelle",
  checkpoint_done: "Umzug abgeschlossen",
};

/** Auftragsstatus — auf Deutsch (wie auf der Anfrageseite). */
const STATUS_RU: Record<string, string> = {
  new: "Neu", confirmed: "Bestätigt", assigned: "Fahrzeug zugewiesen",
  enroute: "Unterwegs", acceptance: "Abnahme", closed: "Abgeschlossen", cancelled: "Storniert",
};

/** Lesbare Bezeichnung des Audit-Ereignisses. */
const AUDIT_ACTION: Record<string, string> = {
  login: "Anmeldung",
  register: "Registrierung",
  email_verified: "E-Mail bestätigt",
  password_reset_requested: "Passwort-Reset angefordert",
  password_reset: "Passwort per Link geändert",
  password_changed: "Passwort geändert",
  password_reset_unknown_email: "Passwort-Reset auf unbekannte E-Mail",
  order_created: "Anfrage erstellt",
  order_confirmed: "Anfrage bestätigt (Preis fixiert)",
  order_recalculated: "Anfrage neu berechnet",
  order_cancelled: "Anfrage storniert",
  order_assigned: "Fahrzeug und Crew zugewiesen",
  order_enroute: "Fahrzeug unterwegs",
  order_accepted: "Kunde hat die Leistung abgenommen",
  order_force_accepted: "Ohne Kundenbestätigung abgeschlossen",
  protocol_signed: "Abnahmeprotokoll unterschrieben",
  invoice_created: "Rechnung erstellt",
  invoice_cancelled: "Rechnung storniert",
  payment_recorded: "Zahlung erfasst",
  payment_refunded: "Erstattung durchgeführt",
  dunning_refresh: "Zahlungserinnerungen aktualisiert",
  claim_created: "Beanstandung erstellt",
  claim_status: "Beanstandungsstatus geändert",
  config_update: "Tarife/Einstellungen geändert",
  vehicle_class_update: "Fahrzeugklasse geändert",
  vehicle_update: "Fahrzeug geändert",
  vehicle_created: "Fahrzeug hinzugefügt",
  vehicle_deleted: "Fahrzeug gelöscht",
  user_update: "Benutzer geändert",
  maps_key_updated: "Google-Maps-Key aktualisiert",
  account_anonymized: "Konto gelöscht (anonymisiert)",
  message_sent: "Nachricht zur Anfrage gesendet",
};

/** Objekttypen des Audit auf Deutsch. */
const AUDIT_ENTITY: Record<string, string> = {
  user: "Benutzer",
  order: "Anfrage",
  invoice: "Rechnung",
  claim: "Beanstandung",
  config: "Einstellungen",
  vehicle: "Fahrzeug",
  vehicle_class: "Fahrzeugklasse",
};

/** Lesbare Audit-Details (Übersetzung der technischen Schlüsselfelder). */
function auditDetails(action: string, details: string): string {
  if (!details) return "";
  try {
    const d = JSON.parse(details) as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(d)) {
      const val = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
      switch (k) {
        case "gross": parts.push(`Betrag ${fmtCents(Number(v))}`); break;
        case "amount": parts.push(`Betrag ${fmtCents(Number(v))}`); break;
        case "from_status": parts.push(`von „${STATUS_RU[String(v)] ?? String(v)}“`); break;
        case "from": parts.push(STATUS_RU[String(v)] ? `war: ${STATUS_RU[String(v)]}` : `war: ${val}`); break;
        case "to": parts.push(STATUS_RU[String(v)] ? `wurde: ${STATUS_RU[String(v)]}` : `wurde: ${val}`); break;
        case "vehicle": parts.push(`Fahrzeug Nr. ${v}`); break;
        case "driver": parts.push(`Fahrer Nr. ${v}`); break;
        case "co": parts.push(`Zweiter Fahrer Nr. ${v}`); break;
        case "method": parts.push(`Art: ${String(v)}`); break;
        case "invoice": parts.push(`Rechnung ${v}`); break;
        case "order": parts.push(`Anfrage ${v}`); break;
        case "deviation": parts.push(`Abweichung: ${v} m³`); break;
        case "forced": parts.push("erzwungen"); break;
        case "anon": parts.push(`anonymisiert als ${v}`); break;
        case "role": parts.push(`Rolle: ${HISTORY_ROLE[String(v)] ?? String(v)}`); break;
        case "len": break; // Nachrichtenlänge — uninteressant
        case "ref": break; // wiederholt die Anfragenummer
        default: parts.push(`${k}: ${val}`);
      }
    }
    return parts.join(", ");
  } catch {
    // Alte Nicht-JSON-Details — lesbare key=value-Paare
    return details
      .replace(/gross=(\d+)/g, (_, n) => `Betrag ${fmtCents(Number(n))}`)
      .replace(/amount=(\d+)/g, (_, n) => `Betrag ${fmtCents(Number(n))}`)
      .replace(/from_status=([a-z_]+)/g, (_, s) => `von „${STATUS_RU[s] ?? s}“`)
      .replace(/vehicle=(\d+)/g, (_, n) => `Fahrzeug Nr. ${n}`)
      .replace(/driver=(\d+)/g, (_, n) => `Fahrer Nr. ${n}`)
      .replace(/co=(\d+)/g, (_, n) => `Zweiter Fahrer Nr. ${n}`)
      .replace(/method=([a-z_]+)/g, (_, s) => `Art: ${s}`)
      .replace(/order=([A-Z0-9-]+)/g, (_, r) => `Anfrage ${r}`)
      .replace(/deviation=(-?\d+)/g, (_, n) => `Abweichung: ${n} m³`)
      .replace(/anon=(\S+)/, (_, a) => `anonymisiert als ${a}`)
      .replace(/role=([a-z]+)/, (_, r) => `Rolle: ${HISTORY_ROLE[r] ?? r}`)
      .replace(/\blen=\d+,?\s*/g, "")
      .replace(/touched=(\d+)/, (_, n) => `betroffene Rechnungen: ${n}`);
  }
}

function fmtCents(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

/** Lesbare Details des Auftrags-Historie-Ereignisses. */
function historyDetails(action: string, details: string): string {
  try {
    const d = JSON.parse(details) as Record<string, unknown>;
    if (action === "revision_accepted" && typeof d.from_gross === "number" && typeof d.to_gross === "number") {
      return `${fmtCents(d.from_gross)} → ${fmtCents(d.to_gross)}`;
    }
    if (action === "revision_rejected" && typeof d.rejected_gross === "number") {
      return `Preis abgelehnt: ${fmtCents(d.rejected_gross)}`;
    }
    if (action === "revision_proposed" && typeof d.new_gross === "number" && typeof d.old_gross === "number") {
      const fields = d.fields as Record<string, { from: unknown; to: unknown }> | undefined;
      const names = fields ? Object.keys(fields).join(", ") : "";
      return `${names}: ${fmtCents(d.old_gross)} → ${fmtCents(d.new_gross)}`;
    }
    if (action === "status_changed" && typeof d.from === "string" && typeof d.to === "string") {
      const extra: string[] = [];
      if (typeof d.vehicle === "number") extra.push(`Fahrzeug Nr. ${d.vehicle}`);
      if (typeof d.driver === "number") extra.push(`Fahrer Nr. ${d.driver}`);
      if (typeof d.invoice === "string") extra.push(`Rechnung ${d.invoice}`);
      if (d.forced === true) extra.push("erzwungen");
      return `${STATUS_RU[d.from] ?? d.from} → ${STATUS_RU[d.to] ?? d.to}${extra.length ? `, ${extra.join(", ")}` : ""}`;
    }
    if (action === "cancelled" && typeof d.from_status === "string") return `vom Status „${STATUS_RU[d.from_status] ?? d.from_status}“`;
    if (action === "order_created" && typeof d.gross === "number" && typeof d.ref === "string") {
      return `Betrag ${fmtCents(d.gross)}`;
    }
    return Object.entries(d).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" ");
  } catch {
    return details;
  }
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ msg?: string; details?: string }> }) {
  await connection();
  await requireRole(["admin"], "/de/admin");
  const db = await getDb();
  const { msg } = await searchParams;
  // Lokale Server-Action-Wrapper (FormData → Actions)
  async function tariffsForm(fd: FormData): Promise<void> {
    "use server";
    const values: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("cfg_") && typeof v === "string") values[k.slice(4)] = v;
    const r: TariffBatchResult = await updateTariffsAction(values);
    const { redirect } = await import("next/navigation");
    redirect(`/de/admin?msg=${r.ok ? "tariffs" : "error"}`);
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
    redirect(`/de/admin?msg=${r.ok ? "class" : "error"}`);
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
    redirect(`/de/admin?msg=${r.ok ? "user" : "error"}`);
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
      homeBase: String(fd.get("homeBase") ?? ""),
    });
    const { redirect } = await import("next/navigation");
    redirect(`/de/admin?msg=${r.ok ? "vehicle" : "error"}`);
  }
  async function vehicleReturnForm(fd: FormData): Promise<void> {
    "use server";
    const r = await returnVehicleAction(Number(fd.get("vehicleId")));
    const { redirect } = await import("next/navigation");
    redirect(`/de/admin?msg=${r.ok ? "vehicle" : "vehicleBusy"}&details=${encodeURIComponent(r.message ?? "")}`);
  }
  async function vehicleDeleteForm(fd: FormData): Promise<void> {
    "use server";
    const r = await deleteVehicleAction(Number(fd.get("vehicleId")));
    const { redirect } = await import("next/navigation");
    redirect(`/de/admin?msg=${r.ok ? "vehicleDel" : r.message?.includes("нельзя") ? "vehicleBusy" : "error"}`);
  }
  async function staffCreateForm(fd: FormData): Promise<void> {
    "use server";
    const r = await createStaffUserAction({
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      role: String(fd.get("role") ?? "driver"),
      password: String(fd.get("password") ?? ""),
    });
    const { redirect } = await import("next/navigation");
    redirect(`/de/admin?msg=${r.ok ? "staffCreated" : "staffError"}&details=${encodeURIComponent(r.message ?? "")}`);
  }
  async function apiKeyForm(fd: FormData): Promise<void> {
    "use server";
    const r = await updateApiKeyAction(String(fd.get("apiKey") ?? ""));
    const { redirect } = await import("next/navigation");
    redirect(`/de/admin?msg=${r.ok ? "apikey" : "error"}`);
  }
  async function subForm(fd: FormData): Promise<void> {
    "use server";
    const r = await createSubcontractorAction({
      name: String(fd.get("name") ?? ""),
      contact: String(fd.get("contact") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      email: String(fd.get("email") ?? ""),
      cls: String(fd.get("cls") ?? "B") as "A" | "B" | "C",
      priceMode: String(fd.get("priceMode") ?? "per_order") as "per_km" | "per_order" | "per_day",
      priceCents: Math.round(Number(String(fd.get("price") ?? "0").replace(",", ".")) * 100),
      notes: String(fd.get("notes") ?? ""),
    });
    const { redirect } = await import("next/navigation");
    redirect(`/de/admin?msg=${r.ok ? "subCreated" : "subError"}&details=${encodeURIComponent(r.message ?? "")}`);
  }
  async function subToggleForm(fd: FormData): Promise<void> {
    "use server";
    const r = await toggleSubcontractorAction(Number(fd.get("subId")));
    const { redirect } = await import("next/navigation");
    redirect(`/de/admin?msg=${r.ok ? "subToggled" : "error"}`);
  }
  async function bindForm(fd: FormData): Promise<void> {
    "use server";
    const vRaw = String(fd.get("vehicleId") ?? "");
    const r = await bindDriverVehicleAction(Number(fd.get("driverId")), vRaw === "" ? null : Number(vRaw));
    const { redirect } = await import("next/navigation");
    redirect(`/de/admin?msg=${r.ok ? "bindOk" : "error"}&details=${encodeURIComponent(r.message ?? "")}`);
  }

  const configRowsRes = await db.execute("SELECT key, value FROM config");
  const configRows = configRowsRes.rows as unknown as { key: string; value: string }[];
  const configMap = new Map(configRows.map((r) => [r.key, r.value]));
  const tariffKeys = Object.keys(CONFIG_SCHEMA).filter((k) => k.startsWith("pricing.") || k === "finance.due_days");
  const classesRes = await db.execute("SELECT * FROM vehicle_classes ORDER BY class");
  const classes = classesRes.rows as unknown as ClassRow[];
  const usersRes = await db.execute("SELECT id, email, name, role, active, email_verified, driver_vehicle_id FROM users ORDER BY role, id");
  const users = usersRes.rows as unknown as UserRow[];
  const vehiclesRes = await db.execute("SELECT id, plate, class, label, capacity_m3, active, home_base, current_location FROM vehicles ORDER BY id");
  const vehicles = vehiclesRes.rows as unknown as VehicleRow[];
  const subsRes = await db.execute("SELECT id, name, contact, phone, email, class, price_mode, price_cents, notes, active FROM subcontractors ORDER BY id");
  const subs = subsRes.rows as unknown as SubRow[];
  const auditRowsRes = await db.execute("SELECT * FROM audit ORDER BY id DESC LIMIT 50");
  const auditRows = auditRowsRes.rows as unknown as AuditRow[];
  const historyRows = await listAllOrderHistory(db, 100);
  const chain = await verifyChain(db);
  const apiKeySet = !!configMap.get("maps.api_key");

  const MSG: Record<string, { text: string; ok: boolean }> = {
    tariffs: { text: "Tarife gespeichert.", ok: true },
    class: { text: "Klasse aktualisiert.", ok: true },
    user: { text: "Benutzer aktualisiert.", ok: true },
    vehicle: { text: "Fahrzeug gespeichert.", ok: true },
    vehicleDel: { text: "Fahrzeug gelöscht.", ok: true },
    vehicleBusy: { text: "Löschen abgelehnt: es gibt Fahrten/Zuweisungen.", ok: false },
    apikey: { text: "API-Key gespeichert.", ok: true },
    staffCreated: { text: "Mitarbeiter erstellt.", ok: true },
    staffError: { text: "Mitarbeiter nicht erstellt.", ok: false },
    subCreated: { text: "Partner hinzugefügt.", ok: true },
    subToggled: { text: "Partnerstatus geändert.", ok: true },
    subError: { text: "Partner nicht gespeichert.", ok: false },
    bindOk: { text: "Fahrer-Fahrzeug-Bindung gespeichert.", ok: true },
    error: { text: "Nicht gespeichert — bitte markierte Werte prüfen.", ok: false },
  };
  const banner = msg ? MSG[msg] : undefined;
  const bannerDetails = msg === "staffError" || msg === "staffCreated" || msg === "subError" || msg === "bindOk"
    ? (await searchParams).details
    : undefined;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">Adminbereich</h1>
      <p className="mt-1 text-sm text-muted">
        <Link className="text-accent underline" href="/de/analytics">Analytik →</Link>
        {" · "}
        <Link className="text-accent underline" href="/de/inbox">Nachrichten →</Link>
      </p>
      {banner && (
        <div role="status" className={`mt-4 rounded-base border px-4 py-3 text-sm ${banner.ok ? "border-trust/30 bg-emerald-50 text-emerald-900" : "border-danger/30 bg-red-50 text-red-900"}`}>
          {banner.text}
          {bannerDetails && <span className="block mt-1 text-xs opacity-80">{bannerDetails}</span>}
        </div>
      )}

      {/* ── Tarife (D8.1: ein Submit, Batch in Transaktion) ── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Tarife und Faktoren</h2>
        <p className="mt-1 text-sm text-muted">Änderungen wirken nur auf neue Berechnungen; bestehende Aufträge sind durch den Snapshot geschützt.</p>
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
                      <option value="1">Aktiviert</option>
                      <option value="0">Deaktiviert</option>
                    </select>
                  ) : (
                    <input name={`cfg_${k}`} defaultValue={val} inputMode="decimal" className="input-base mt-1" />
                  )}
                </label>
              );
            })}
          </div>
          <SubmitButton className="btn btn-primary mt-4">Tarife speichern</SubmitButton>
        </form>
      </section>

      {/* ── Fahrzeugklassen (D8.4) ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Fahrzeugklassen</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {classes.map((c) => (
            <form key={c.class} action={classForm} className="card p-4">
              <input type="hidden" name="cls" value={c.class} />
              <div className="font-medium">Klasse {c.class}</div>
              <label className="mt-2 block text-sm">
                <span className="text-muted">Bezeichnung</span>
                <input name="label" defaultValue={c.label} className="input-base mt-1" />
              </label>
              <label className="mt-2 block text-sm">
                <span className="text-muted">Kapazität, m³</span>
                <input name="capacity" defaultValue={c.capacity_m3} inputMode="numeric" className="input-base mt-1" />
              </label>
              <label className="mt-2 block text-sm">
                <span className="text-muted">Inkludiertes Volumen, m³</span>
                <input name="included" defaultValue={c.included_m3} inputMode="numeric" className="input-base mt-1" />
              </label>
              <label className="mt-2 block text-sm">
                <span className="text-muted">Grundpreis, €</span>
                <input name="base" defaultValue={(c.base_cents / 100).toString()} inputMode="decimal" className="input-base mt-1" />
              </label>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={c.active === 1} className="size-4" />
                Aktiv (wird neuen Aufträgen vorgeschlagen)
              </label>
              <SubmitButton className="btn btn-secondary mt-3 w-full">Speichern</SubmitButton>
            </form>
          ))}
        </div>
      </section>

      {/* ── Benutzer (D8.2/D8.3) ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Benutzer</h2>
        <div className="mt-4 space-y-3">
          {users.map((u) => (
            <form key={u.id} action={userForm} className="card flex flex-wrap items-end gap-3 p-4">
              <input type="hidden" name="userId" value={u.id} />
              <div className="min-w-48 flex-1">
                <div className="font-medium">{u.name}</div>
                <div className="text-sm text-muted">{u.email}{u.email_verified ? "" : " · nicht bestätigt"}</div>
              </div>
              <label className="text-sm">
                <span className="text-muted">Rolle</span>
                <select name="role" defaultValue={u.role} className="input-base mt-1 w-40">
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_RU[r]}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={u.active === 1} className="size-4" />
                Aktiv
              </label>
              <label className="text-sm">
                <span className="text-muted">Neues Passwort</span>
                <input name="newPassword" type="password" placeholder="— nicht ändern —" className="input-base mt-1 w-40" />
              </label>
              <SubmitButton className="btn btn-secondary">Speichern</SubmitButton>
            </form>
          ))}
        </div>
      </section>

      {/* ── Mitarbeiter anlegen (Erweiterung D8.2) ── */}
      <section className="mt-6">
        <h3 className="font-semibold">Mitarbeiter hinzufügen</h3>
        <p className="mt-1 text-sm text-muted">
          Fahrer, Disponent oder Buchhaltung — das Konto wird sofort aktiv und bestätigt angelegt, der Mitarbeiter kann sich ohne E-Mail-Bestätigung anmelden.
          Träger (Crew-Mitglieder) brauchen kein Konto — sie werden zusammen mit dem Fahrzeug zur Fahrt zugewiesen.
        </p>
        <form action={staffCreateForm} className="card mt-3 flex flex-wrap items-end gap-3 p-4">
          <label className="min-w-48 flex-1 text-sm">
            <span className="text-muted">Vor- und Nachname (lateinisch)</span>
            <input name="name" placeholder="Ivan Petrov" pattern="[A-Za-z]+( [A-Za-z]+)+" className="input-base mt-1" required />
          </label>
          <label className="min-w-48 flex-1 text-sm">
            <span className="text-muted">E-Mail</span>
            <input name="email" type="email" placeholder="ivan@umzugservice.de" className="input-base mt-1" required />
          </label>
          <label className="text-sm">
            <span className="text-muted">Rolle</span>
            <select name="role" defaultValue="driver" className="input-base mt-1 w-40">
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_RU[r]}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted">Passwort (mind. 8 Zeichen)</span>
            <input name="password" type="password" minLength={8} className="input-base mt-1 w-40" required />
          </label>
          <SubmitButton className="btn btn-primary">Mitarbeiter erstellen</SubmitButton>
        </form>
      </section>

      {/* ── Fuhrpark (D8.6) ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Fuhrpark</h2>
        <div className="mt-4 space-y-3">
          {vehicles.map((v) => (
            <div key={v.id} className="card p-4">
              <form action={vehicleForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="vehicleId" value={v.id} />
                <label className="text-sm">
                  <span className="text-muted">Kennzeichen</span>
                  <input name="plate" defaultValue={v.plate} className="input-base mt-1 w-32" />
                </label>
                <label className="text-sm">
                  <span className="text-muted">Klasse</span>
                  <select name="cls" defaultValue={v.class} className="input-base mt-1 w-20">
                    {classes.filter((c) => c.active === 1).map((c) => <option key={c.class} value={c.class}>{c.class}</option>)}
                  </select>
                </label>
                <label className="min-w-40 flex-1 text-sm">
                  <span className="text-muted">Bezeichnung</span>
                  <input name="label" defaultValue={v.label} className="input-base mt-1" />
                </label>
                <div className="text-sm text-muted">Kapazität: {v.capacity_m3} m³ (aus der Klasse)</div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={v.active === 1} className="size-4" />
                  Aktiv
                </label>
                <SubmitButton className="btn btn-secondary">Speichern</SubmitButton>
              </form>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>Basis: {v.home_base || "—"}</span>
                <span>·</span>
                <span>
                  Aktuell: <b className="text-ink">{v.current_location || v.home_base || "—"}</b>
                  {v.current_location && v.home_base && v.current_location !== v.home_base && <span className="chip chip-dispatched ml-1">unterwegs/nicht an der Basis</span>}
                </span>
                <form action={vehicleReturnForm}>
                  <input type="hidden" name="vehicleId" value={v.id} />
                  <SubmitButton className="btn btn-outline h-7 px-2 text-xs">Zurück an der Basis</SubmitButton>
                </form>
              </div>
              <form action={vehicleDeleteForm} className="mt-2">
                <input type="hidden" name="vehicleId" value={v.id} />
                <button type="submit" className="text-sm text-danger hover:underline">Löschen (wenn keine Fahrten)</button>
              </form>
            </div>
          ))}
          {/* Neues Fahrzeug */}
          <form action={vehicleForm} className="card flex flex-wrap items-end gap-3 border-dashed p-4">
            <label className="text-sm">
              <span className="text-muted">Kennzeichen</span>
              <input name="plate" placeholder="B-MA 5005" className="input-base mt-1 w-32" />
            </label>
            <label className="text-sm">
              <span className="text-muted">Klasse</span>
              <select name="cls" defaultValue="A" className="input-base mt-1 w-20">
                {classes.filter((c) => c.active === 1).map((c) => <option key={c.class} value={c.class}>{c.class}</option>)}
              </select>
            </label>
            <label className="min-w-40 flex-1 text-sm">
              <span className="text-muted">Bezeichnung</span>
              <input name="label" placeholder="Transporter 3,5 t" className="input-base mt-1" />
            </label>
            <label className="min-w-48 flex-1 text-sm">
              <span className="text-muted">Basis (Heimatstandort)</span>
              <input name="homeBase" placeholder="Musterstraße 12, 10115 Berlin" className="input-base mt-1" />
            </label>
              <input type="hidden" name="active" value="on" />
            <SubmitButton className="btn btn-primary">Fahrzeug hinzufügen</SubmitButton>
          </form>
        </div>
      </section>

      {/* ── Fahrer-Fahrzeug-Bindung (№7): Auto-Zuweisung nimmt das Fahrzeug des Fahrers ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Fahrer-Fahrzeug-Bindung</h2>
        <p className="mt-1 text-sm text-muted">
          Das Hauptfahrzeug des Fahrers — wird vom Button „⚡ Automatisch zuweisen“ und in den Morgenmails an den Fahrer verwendet.
        </p>
        <div className="mt-4 space-y-2">
          {users.filter((u) => u.role === "driver").map((u) => {
            const bound = vehicles.find((v) => v.id === u.driver_vehicle_id);
            return (
              <div key={u.id} className="card flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <span className="font-medium">{u.name} <span className="text-muted">· {u.email}</span></span>
                <span className={bound ? "chip chip-trust" : "chip chip-neutral"}>{bound ? `Hauptfahrzeug: ${bound.plate}` : "Ohne Hauptfahrzeug"}</span>
                <form action={bindForm} className="flex items-center gap-2">
                  <input type="hidden" name="driverId" value={u.id} />
                  <select name="vehicleId" className="input-base h-9 text-sm" defaultValue={u.driver_vehicle_id ?? ""}>
                    <option value="">— ohne —</option>
                    {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} ({v.label})</option>)}
                  </select>
                  <SubmitButton className="btn btn-outline h-9 px-3 text-sm">Speichern</SubmitButton>
                </form>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Subunternehmer (externe Spediteure, Erweiterung D8.6) ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Subunternehmer (Partner-Spediteure)</h2>
        <p className="mt-1 text-sm text-muted">
          Externe Spediteure, denen eine Anfrage statt des eigenen Fahrzeugs übergeben werden kann. Tarif: pro km, pro Auftrag oder pro Tag.
          Die Marge wird automatisch berechnet: Kundenpreis − Partnerkosten (sichtbar für die Disposition in /de/dispatch und die Buchhaltung in /de/finance).
        </p>
        <div className="mt-4 space-y-3">
          {subs.map((s) => (
            <div key={s.id} className="card flex flex-wrap items-center gap-3 p-4 text-sm">
              <div className="min-w-48 flex-1">
                <div className="font-medium">
                  {s.name}
                  <span className={`ml-2 chip ${s.active === 1 ? "chip-trust" : "chip-neutral"}`}>{s.active === 1 ? "aktiv" : "deaktiviert"}</span>
                </div>
                <div className="text-muted">
                  {s.contact && <>{s.contact} · </>}
                  {s.phone && <>{s.phone} · </>}
                  {s.email}
                </div>
                {s.notes && <div className="text-xs text-muted">{s.notes}</div>}
              </div>
              <span className="chip chip-neutral">Klasse {s.class}</span>
              <span className="chip chip-neutral">
                {s.price_mode === "per_km" ? "pro km" : s.price_mode === "per_day" ? "pro Tag" : "pro Auftrag"}: {(s.price_cents / 100).toFixed(2)} €
              </span>
              <form action={subToggleForm}>
                <input type="hidden" name="subId" value={s.id} />
                <SubmitButton className="btn btn-outline">{s.active === 1 ? "Deaktivieren" : "Aktivieren"}</SubmitButton>
              </form>
            </div>
          ))}
          {subs.length === 0 && <div className="card p-4 text-sm text-muted">Noch keine Partner.</div>}
          {/* Neuer Partner */}
          <form action={subForm} className="card flex flex-wrap items-end gap-3 border-dashed p-4">
            <label className="min-w-40 flex-1 text-sm">
              <span className="text-muted">Name</span>
              <input name="name" placeholder="Spedition Müller GmbH" className="input-base mt-1" required />
            </label>
            <label className="text-sm">
              <span className="text-muted">Fahrzeugklasse</span>
              <select name="cls" defaultValue="B" className="input-base mt-1 w-20">
                {classes.map((c) => <option key={c.class} value={c.class}>{c.class}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted">Tarif</span>
              <select name="priceMode" defaultValue="per_order" className="input-base mt-1 w-32">
                <option value="per_order">pro Auftrag</option>
                <option value="per_km">pro km</option>
                <option value="per_day">pro Tag</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted">Preis, €</span>
              <input name="price" inputMode="decimal" placeholder="300" className="input-base mt-1 w-24" required />
            </label>
            <label className="min-w-40 flex-1 text-sm">
              <span className="text-muted">Ansprechpartner</span>
              <input name="contact" placeholder="Herr Müller" className="input-base mt-1" />
            </label>
            <label className="text-sm">
              <span className="text-muted">Telefon</span>
              <input name="phone" placeholder="+49 30 123456" className="input-base mt-1 w-40" />
            </label>
            <label className="min-w-40 flex-1 text-sm">
              <span className="text-muted">E-Mail</span>
              <input name="email" type="email" placeholder="dispo@mueller.de" className="input-base mt-1" />
            </label>
            <label className="min-w-40 flex-1 text-sm">
              <span className="text-muted">Notizen</span>
              <input name="notes" placeholder="Konditionen, besondere Wünsche" className="input-base mt-1" />
            </label>
            <SubmitButton className="btn btn-primary">Partner hinzufügen</SubmitButton>
          </form>
        </div>
      </section>

      {/* ── maps.api_key (D8.5) ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Google-Maps-API-Key</h2>
        <p className="mt-1 text-sm text-muted">
          Status: {apiKeySet ? <span className="text-trust">gesetzt</span> : <span className="text-muted">nicht gesetzt (OSRM/OSM wird verwendet)</span>}.
          Der Key wird nicht angezeigt; leere Eingabe = nicht ändern. Solange kein Key vorhanden ist, läuft die Routenberechnung über OSRM/OSM mit derselben Schnittstelle.
        </p>
        <form action={apiKeyForm} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="text-muted">Neuer Key (Google Distance Matrix + Geocoding)</span>
            <input name="apiKey" type="password" placeholder="— nicht ändern —" className="input-base mt-1 w-80" />
          </label>
          <SubmitButton className="btn btn-secondary">Key speichern</SubmitButton>
        </form>
      </section>

      {/* ── Auftrags-Historie (D10, vollständig — inkl. client_visible=0) ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Auftrags-Historie (100 letzte)</h2>
        <p className="mt-1 text-sm text-muted">
          Alle Operationen zu jedem Auftrag: Erstellung, Preisänderungen (mit alten → neuen Werten), Entscheidungen der Seiten,
          Statuswechsel, Stornierung. Der Kunde sieht auf seiner Seite nur den offenen Teil (ohne interne Details).
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-2">Wann</th><th>Auftrag</th><th>Rolle</th><th>Ereignis</th><th>Details</th>
            </tr>
          </thead>
          <tbody>
            {historyRows.map((h) => (
              <tr key={h.id} className="border-t border-line">
                <td className="py-2 whitespace-nowrap">{new Date(h.at * 1000).toLocaleString("de-DE")}</td>
                <td>
                  <Link className="text-accent hover:underline" href={`/de/order/${h.ref}`}>{h.ref}</Link>
                  {!h.client_visible && <span className="ml-1 chip chip-neutral">intern</span>}
                </td>
                <td>{HISTORY_ROLE[h.actor_role] ?? h.actor_role}{h.actor_name ? ` · ${h.actor_name}` : ""}</td>
                <td>{HISTORY_ACTION[h.action] ?? h.action}</td>
                <td className="text-xs text-muted">{historyDetails(h.action, h.details)}</td>
              </tr>
            ))}
            {historyRows.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-center text-muted">Noch keine Ereignisse.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ── Audit ── */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Audit-Log (50 letzte)</h2>
          <span className={`chip ${chain.valid ? "chip-trust" : "chip-delayed"}`}>
            Protokollkette: {chain.valid ? "gültig" : "UNTERBROCHEN"} · {chain.count}
          </span>
        </div>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-2">Wann</th><th>Wer (ID)</th><th>Aktion</th><th>Objekt</th><th>Details</th>
            </tr>
          </thead>
          <tbody>
            {auditRows.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="py-2 whitespace-nowrap">{new Date(a.at * 1000).toLocaleString("de-DE")}</td>
                <td>{a.user_id}</td>
                <td>{AUDIT_ACTION[a.action] ?? a.action}</td>
                <td>{AUDIT_ENTITY[a.entity] ?? a.entity}{a.entity_id ? ` ${a.entity_id}` : ""}</td>
                <td className="text-xs text-muted">{auditDetails(a.action, a.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="mt-8 text-xs text-muted">
        Demo-Umgebung: Tarifänderungen wirken nur auf neue Aufträge; bestehende sind durch den Preis-Snapshot geschützt.
      </p>
    </div>
  );
}
