// DE-Version: Anfrage-Seite /de/order/{ref} (Besitzer kunde oder logist/admin).
// Kopie der RU-Seite mit ko-lokalisierten deutschen Texten (kein zentrales Wörterbuch).

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { getDb, findSession, getTariffs, type SessionUser } from "@/lib/db";
import { recalculate, type QuoteSnapshot } from "@/lib/pricing";
import { tariffDrift } from "@/lib/ops";
import { AcceptanceButton } from "@/components/acceptance-button";
import RouteMapLazy from "@/components/route-map-lazy";
import CrewMapLazy from "@/components/crew-map-lazy";
import { RevisionForm } from "@/components/revision-form";
import { RevisionDecision } from "@/components/revision-decision";
import { orderHistory, snapshotVersions } from "@/lib/db";
import { canRevise, hoursUntilMove, orderAgeHours, revisionFieldDiff, type OrderForRevision } from "@/lib/revision";
import { MessageThread, type MessageRow } from "@/app/order/[ref]/message-thread";

export const metadata: Metadata = { title: "Anfrage", robots: { index: false } };
export const instant = false;

const STATUS_LABEL: Record<string, string> = {
  new: "Neue Anfrage",
  confirmed: "Bestätigt",
  assigned: "Fahrzeug zugewiesen",
  enroute: "Unterwegs",
  acceptance: "Abnahme",
  closed: "Abschlossen",
  cancelled: "Storniert",
};

function fmt(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso + "T12:00:00"));
}

export default async function OrderDePage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ msg?: string }> }) {
  await connection();
  const { ref } = await params;
  const { msg } = await searchParams;
  const db = await getDb();
  const jar = await cookies();
  const user: SessionUser | null = await findSession(db, jar.get("ms_session")?.value ?? "");
  if (!user) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <p className="mb-4">Bitte anmelden, um die Anfrage zu sehen.</p>
        <Link className="btn btn-primary" href={`/de/login?next=${encodeURIComponent(`/de/order/${ref}`)}`}>Anmelden</Link>
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
    return <main className="mx-auto max-w-xl px-4 py-10"><p>Anfrage nicht gefunden.</p></main>;
  }
  // Audit #3: zugewiesener Fahrer sieht die Anfrage ebenfalls.
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
    return <main className="mx-auto max-w-xl px-4 py-10"><p>Kein Zugriff auf diese Anfrage.</p></main>;
  }
  // Audit #2: Disponent/Admin hat die Anfrage geöffnet — Kundennachrichten als gelesen markieren.
  if (user.role === "logist" || user.role === "admin") {
    const nowS = Math.floor(Date.parse(new Date().toISOString()) / 1000);
    await db.execute({
      sql: "UPDATE messages SET read_at = ? WHERE order_id = ? AND read_at IS NULL AND from_role <> ?",
      args: [nowS, order.id, user.role],
    });
  }

  const snap = JSON.parse(order.snapshot) as QuoteSnapshot;
  const tariffs = await getTariffs(db);
  const priceChanged = tariffDrift(snap, Number(order.gross_cents), tariffs);
  const expired = snap.quoteValidUntil < new Date().toISOString().slice(0, 10);
  const linesRes = await db.execute({
    sql: "SELECT key, label, amount, meta FROM order_lines WHERE order_id = ? ORDER BY idx",
    args: [order.id],
  });
  const lines = linesRes.rows as unknown as
    Array<{ key: string; label: string; amount: number }>;
  // D6.7: Annahme-Trigger — Protokoll vorhanden + enroute + Betrachter = Besitzer-kunde
  const protoRes = await db.execute({
    sql: "SELECT id FROM protocol WHERE order_id = ?",
    args: [order.id],
  });
  const proto = protoRes.rows[0];
  const showAcceptance = order.status === "enroute" && !!proto && user.role === "kunde" && order.client_id === user.id;
  // D7: Rechnung sichtbar für den Kunden nach Abschluss
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
  // Routengeometrie für die Karte (Leaflet; null bei alten Anfragen oder ohne Geometrie)
  const routeRes = await db.execute({
    sql: "SELECT geometry FROM route WHERE order_id = ?",
    args: [order.id],
  });
  const routeRow = routeRes.rows[0] as unknown as { geometry: string | null } | undefined;
  const geometry = routeRow?.geometry ? (JSON.parse(routeRow.geometry) as [number, number][]) : null;
  // D10: Revision + Verlauf
  const revOrder = order as unknown as OrderForRevision;
  const isOwner = order.client_id === user.id;
  const revRole: "kunde" | "logist" | null = isOwner && user.role === "kunde" ? "kunde"
    : (user.role === "logist" || user.role === "admin") ? "logist" : null;
  const reviseGuard = revRole ? canRevise(revOrder, revRole) : { ok: false as const, reason: "" };
  const hoursLeft = Math.round(hoursUntilMove(order.move_date));
  const pendingSnap = order.pending_snapshot ? (JSON.parse(order.pending_snapshot) as QuoteSnapshot) : null;
  const history = await orderHistory(db, order.id);
  const versions = await snapshotVersions(db, order.id);
  // Aufgabe 9: Inbox — letzte Nachrichten zur Anfrage
  const msgRes = await db.execute({
    sql: "SELECT id, from_role, from_email, body, created_at FROM messages WHERE order_id = ? ORDER BY created_at ASC LIMIT 100",
    args: [order.id],
  });
  const initialMessages = msgRes.rows as unknown as MessageRow[];
  // D11: Team-Karte nach Zuweisung (Namen + Fahrzeug, ohne Telefonnummern — PII)
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

  // Nr. 9: Live-Status des Teams — Kette der Checkpoints der Fahrt (für den Kunden sichtbar).
  // Position (lat/lon) nur während der Fahrt (enroute) auf der Karte — danach genügt die Chronologie.
  const CP_LABEL: Record<string, string> = {
    departed: "Losgefahren",
    arrived_load: "An der Ladestelle",
    loaded: "Gut beladen",
    arrived_unload: "An der Entladestelle",
    done: "Umzug abgeschlossen",
  };
  let checkpoints: Array<{ cp: string; at: number; lat: number | null; lon: number | null }> = [];
  {
    const cpRes = await db.execute({
      sql: "SELECT cp, created_at AS at, lat, lon FROM trip_checkpoints WHERE order_id = ? ORDER BY created_at",
      args: [order.id],
    });
    checkpoints = cpRes.rows as unknown as Array<{ cp: string; at: number; lat: number | null; lon: number | null }>;
  }
  const lastCp = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
  // Letzter Checkpoint mit Koordinaten — für die Positions-Karte des Teams
  const crewPos = [...checkpoints].reverse().find((c) => c.lat != null && c.lon != null) ?? null;
  // Dedup für die Kette: aufeinanderfolgende gleiche cp nur einmal zeigen
  const cpChain = checkpoints.filter((c, i) => i === 0 || checkpoints[i - 1].cp !== c.cp);

  // UX-Feedback: Banner nach Aktionen (router.replace(?msg=...))
  const ORDER_MSG: Record<string, string> = {
    accepted: "Abnahme bestätigt. Der Disponent hat den Auftrag zum Abschluss erhalten.",
    revision_accepted: "Änderung angenommen, Preis aktualisiert.",
    revision_rejected: "Änderung abgelehnt. Preis unverändert.",
    revision_proposed: "Änderung an die andere Seite gesendet. Antwort erscheint hier.",
    cancelled: "Anfrage storniert.",
  };
  const orderMsg = msg ? ORDER_MSG[msg] : undefined;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="text-sm text-muted">Anfrage</p>
      <h1 className="mb-4 text-2xl font-bold sm:text-3xl">{order.ref}</h1>
      <p className="mb-6 inline-block rounded-full bg-surface-2 px-3 py-1 text-sm">{STATUS_LABEL[order.status] ?? order.status}</p>

      {/* D11: Team nach Zuweisung */}
      {crewRow && ["assigned", "enroute", "acceptance", "closed"].includes(order.status) && (
        <div className="mb-6 card p-5">
          <h2 className="mb-2 font-semibold">Ihr Team</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Fahrzeug</dt><dd className="text-right">{crewRow.vehicle_label} · {crewRow.plate}</dd></div>
            <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Fahrer</dt><dd>{crewRow.driver_name ?? "—"}</dd></div>
            {crewRow.codriver_name && crewRow.codriver_name !== crewRow.driver_name && (
              <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Zweiter Fahrer</dt><dd>{crewRow.codriver_name}</dd></div>
            )}
          </dl>
        </div>
      )}

      {/* D11: Hinweis zu Änderungsfristen */}
      {order.status === "new" && (
        <p className="mb-6 text-xs text-muted">
          Bis zum Umzug {Math.max(0, Math.round(hoursLeft / 24))} Tage · Änderungen möglich bis {((): string => { const d = new Date(order.move_date + "T08:00:00Z"); d.setUTCHours(d.getUTCHours() - 72); return d.toISOString().slice(0, 10); })()} (72 Std. vor Abfahrt).
        </p>
      )}

      {orderMsg && (
        <div className="mb-6 rounded-container border border-trust/40 bg-emerald-50 px-4 py-3 text-sm" role="status" aria-live="polite">
          {orderMsg}
        </div>
      )}

      {(priceChanged || expired) && (
        <div className="mb-6 rounded-container border border-accent-soft bg-orange-50 px-4 py-3 text-sm" role="status">
          Tarife haben sich geändert oder das Angebot ist abgelaufen ({snap.quoteValidUntil}). Neuberechnung erfolgt durch den Disponenten bei der Bestätigung.
        </div>
      )}

      {showAcceptance && (
        <div className="mb-6 rounded-container border border-trust/40 bg-emerald-50 px-4 py-4" role="status">
          <p className="mb-3 font-semibold">Umzug abgeschlossen. Bitte bestätigen Sie, dass alles in Ordnung ist.</p>
          <p className="mb-3 text-sm text-muted">
            Der Fahrer hat ein Protokoll erstellt (Ist-Beladung, Unterschrift). Ihre Bestätigung setzt die Anfrage auf „Abnahme“,
            danach schließt der Disponent den Auftrag und die Rechnung wird erstellt.
          </p>
          <AcceptanceButton orderId={order.id} />
        </div>
      )}

      <div className="card mb-6 p-5">
        <h2 className="mb-3 font-semibold">Strecke und Datum</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Von</dt><dd className="text-right">{order.from_text}</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Nach</dt><dd className="text-right">{order.to_text}</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Entfernung</dt><dd className="tabular-nums">{order.distance_km} km</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Datum</dt><dd>{dateLabel(order.move_date)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Volumen</dt><dd className="tabular-nums">{order.volume_m3} m³</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Fahrzeugklasse</dt><dd>{snap.config.vehicleClass}</dd></div>
          {order.start_time && <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Beladung beginnt</dt><dd>{order.start_time}</dd></div>}
          {!!order.self_pack && <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted">Verpackung</dt><dd>In Eigenregie</dd></div>}
          {order.special_requests && (
            <div className="sm:col-span-2">
              <dt className="text-muted">Ihre besonderen Wünsche</dt>
              <dd className="mt-1 whitespace-pre-wrap">{order.special_requests}</dd>
              <dd className="mt-1 text-xs">
                {order.special_approved === 1 && <span className="text-trust">✓ Vom Disponenten bestätigt</span>}
                {order.special_approved === 0 && <span className="text-danger">✕ Abgelehnt — wir melden uns im Nachrichtenverlauf</span>}
                {order.special_approved === null && <span className="text-muted">⏳ In Klärung beim Disponenten</span>}
              </dd>
            </div>
          )}
        </dl>
        {geometry && <div className="mt-4"><RouteMapLazy geometry={geometry} fromText={order.from_text} toText={order.to_text} /></div>}
      </div>

      <div className="card mb-6 p-5">
        <h2 className="mb-3 font-semibold">Berechnung</h2>
        <dl className="grid gap-1.5 text-sm">
          {lines.map((l, i) => (
            <div key={`${l.key}-${i}`} className="flex justify-between gap-3">
              <dt className="text-muted">{l.label}</dt>
              <dd className="tabular-nums">{fmt(l.amount)}</dd>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
            <dt>Brutto</dt>
            <dd className="tabular-nums">{fmt(Number(order.gross_cents))}</dd>
          </div>
          <div className="flex justify-between text-muted">
            <dt>Anzahlung</dt>
            <dd className="tabular-nums">{fmt(Number(order.deposit_cents))}</dd>
          </div>
          <div className="flex justify-between text-muted">
            <dt>Restbetrag</dt>
            <dd className="tabular-nums">{fmt(Number(order.remainder_cents))}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs font-medium text-ink">Angebot gültig bis {dateLabel(snap.quoteValidUntil)}.</p>
      </div>

      {/* D10: aktive Revision — Diff-Karte */}
      {pendingSnap && <PendingRevisionCardDe orderId={order.id} pendingSnapshot={order.pending_snapshot!} currentSnapshot={order.snapshot} requestedBy={order.revision_requested_by ?? ""} viewerRole={user.role} isOwner={isOwner} />}

      {/* D10: Disponent schweigt — Alter der Anfrage (new) */}
      {order.status === "new" && (() => {
        const ageH = orderAgeHours(revOrder);
        if (ageH < 24) return null;
        return (
          <div className="mb-6 rounded-container border border-line bg-surface px-4 py-3 text-sm" role="status">
            Die Anfrage wartet bereits seit {Math.floor(ageH)} Std. auf Bestätigung.
            {ageH > 48 && " Sie können die Anfrage stornieren und sich andersweitig umsehen."}
          </div>
        );
      })()}

      {/* D10: Formular für Änderungen (Besitzer oder Disponent) */}
      {revRole && !pendingSnap && (order.status === "new" || order.status === "confirmed") && (
        <div className="card mb-6 p-5">
          <h2 className="mb-2 font-semibold">Anfrage ändern</h2>
          <RevisionForm
            orderId={order.id}
            role={revRole}
            canRevise={reviseGuard.ok}
            deadlineHint={reviseGuard.ok
              ? `Änderungen noch ca. ${Math.max(0, hoursLeft - (revRole === "kunde" ? 72 : 48))} Std. möglich (Schwelle ${revRole === "kunde" ? "72" : "48"} Std.); bis zum Umzug ${hoursLeft} Std.`
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

      {/* D10: Verlauf der Anfrage */}
      <div className="card mb-6 p-5">
        <h2 className="mb-3 font-semibold">Verlauf</h2>
        {history.length === 0 && <p className="text-sm text-muted">Noch keine Ereignisse.</p>}
        <ul className="grid gap-2 text-sm">
          {history.map((h) => <HistoryEntryDe key={h.id} at={Number(h.at)} role={h.actor_role} action={h.action} details={h.details} actorName={h.actor_name} />)}
        </ul>
        {versions.length > 1 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-accent">Frühere Preise ({versions.length - 1})</summary>
            <ul className="mt-2 grid gap-1 text-sm">
              {versions.slice(1).map((v) => (
                <li key={v.version} className="flex justify-between border-b border-line py-1">
                  <span className="text-muted">Version {v.version} · {dateLabel(new Date(Number(v.at) * 1000).toISOString().slice(0, 10))}</span>
                  <span className="tabular-nums">{fmt(Number(v.gross_cents))}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {invoice && (
        <div className="card mb-6 p-5">
          <h2 className="mb-3 font-semibold">Rechnung {invoice.number}</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Betrag</dt><dd className="tabular-nums">{fmt(invoice.amount_cents)}</dd></div>
            <div><dt className="text-muted">Status</dt><dd>
              {invoice.paid_at ? <span className="chip chip-trust">Bezahlt</span>
                : invoice.status === "overdue" ? <span className="chip chip-delayed">Überfällig</span>
                : invoice.status === "cancelled" ? <span className="chip chip-neutral">Storniert</span>
                : <span className="chip chip-dispatched">Offen</span>}
            </dd></div>
            <div><dt className="text-muted">Fällig am</dt><dd className="tabular-nums">{dateLabel(invoice.due_date)}</dd></div>
            <div><dt className="text-muted">Bezahlt</dt><dd className="tabular-nums">{fmt(invoicePaid)}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-muted">Restbetrag: {fmt(Math.max(0, invoice.amount_cents - invoicePaid))}. Zahlung laut Rechnungsdaten (Demo).</p>
          <a className="btn btn-outline mt-3 inline-block px-3 py-1.5 text-sm" href={`/api/pdf/invoice/${invoice.number}`} target="_blank" rel="noopener">PDF herunterladen</a>
        </div>
      )}

      {/* Nr. 9: Live-Status des Teams — Kette der Checkpoints + Positions-Karte (enroute) */}
      {lastCp && (
        <div className="mb-6 rounded-base border border-trust/30 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold">Crew-Status</p>
          <p className="mt-1">
            <span className="chip chip-trust">✓ {CP_LABEL[lastCp.cp] ?? lastCp.cp}</span>
            {" · "}
            <span className="text-muted">{new Date(lastCp.at * 1000).toLocaleString("de-DE")}</span>
          </p>
          {/* Chronologie der Etappen — sichtbar nach Abfahrt in jedem Status */}
          {cpChain.length > 1 && (
            <ol className="mt-2 space-y-0.5 text-xs text-muted">
              {cpChain.map((c) => (
                <li key={`${c.cp}-${c.at}`}>
                  ✓ {CP_LABEL[c.cp] ?? c.cp} — {new Date(c.at * 1000).toLocaleString("de-DE")}
                </li>
              ))}
            </ol>
          )}
          {/* Positions-Karte: nur während der Fahrt und mit Koordinaten */}
          {order.status === "enroute" && crewPos && (
            <div className="mt-3">
              <CrewMapLazy
                geometry={geometry}
                crew={{ lat: crewPos.lat!, lon: crewPos.lon!, at: crewPos.at, cpLabel: CP_LABEL[crewPos.cp] ?? crewPos.cp }}
                fromText={order.from_text}
                toText={order.to_text}
              />
              <p className="mt-1 text-xs text-muted">
                📍 Der Fahrer markiert die Etappen der Fahrt per Smartphone — der Ort der Markierung wird automatisch gespeichert, damit Sie den Fortschritt sehen.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Inbox — Nachrichtenverlauf Kunde & Personal */}
      <MessageThread orderRef={order.ref} initial={initialMessages} viewerRole={user.role} />

      {/* Kostenvoranschlag — PDF (Kunde/Disponent) */}
      <div className="mb-6">
        <a className="btn btn-outline px-3 py-1.5 text-sm" href={`/api/pdf/quote/${order.ref}`} target="_blank" rel="noopener">Kostenvoranschlag (PDF)</a>
      </div>

      <Link className="btn btn-outline" href="/de/login">Zum Kundenkonto</Link>
    </main>
  );
}

// ─── D10: Unterkomponenten (DE) ──────────────────────────────────────────

/** Diff-Karte der aktiven Revision (DE). */
function PendingRevisionCardDe({ orderId, pendingSnapshot, currentSnapshot, requestedBy, viewerRole, isOwner }: {
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
  const decider = requestedBy === "logist" ? "Kunde" : "Disponent";
  const canDecide = (requestedBy === "logist" && isOwner && viewerRole === "kunde")
    || (requestedBy === "kunde" && (viewerRole === "logist" || viewerRole === "admin"));

  return (
    <div className="mb-6 rounded-container border border-accent-soft bg-orange-50 p-5">
      <h2 className="font-semibold">
        {requestedBy === "logist" ? "Der Disponent schlägt eine Änderung vor" : "Der Kunde beantragt eine Änderung"} — wartet auf Bestätigung ({decider})
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
          <dt>Preis (brutto)</dt>
          <dd className="tabular-nums">
            <span className="text-muted line-through">{fmt(currentGross)}</span>
            <span className="mx-1">→</span>
            <b>{fmt(pendingQuote.gross)}</b>
          </dd>
        </div>
        <div className="flex justify-between text-muted"><dt>Anzahlung 30 % (neu)</dt><dd className="tabular-nums">{fmt(pendingQuote.deposit)}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-muted">Berechnung nach aktuellen Tarifen; gültig bis {dateLabel(pending.quoteValidUntil)}.</p>
      {canDecide && <div className="mt-3"><RevisionDecision orderId={orderId} kind="accept" /></div>}
      {!canDecide && <p className="mt-3 text-sm text-muted">Entscheidung durch {decider === "Kunde" ? "den Kunden" : "den Disponenten"}.</p>}
    </div>
  );
}

/** Menschenlesbare Ereigniszeile des Verlaufs (DE). */
const ACTION_TEXT: Record<string, string> = {
  order_created: "Anfrage erstellt",
  revision_proposed: "Änderung vorgeschlagen",
  revision_accepted: "Änderung angenommen — Preis aktualisiert",
  revision_rejected: "Änderung abgelehnt",
  status_changed: "Status geändert",
  cancelled: "Anfrage storniert",
  auto_assigned: "Automatisch zugewiesen (optimales Fahrzeug + freies Team)",
  protocol_signed: "Abnahmeprotokoll unterschrieben",
  reminder_deposit: "Anzahlungs-Erinnerung gesendet",
  reminder_invoice: "Rechnungs-Erinnerung gesendet",
  driver_morning_email: "Morgenmail an den Fahrer gesendet",
  traffic_delay: "Verspätungswarnung an den Kunden gesendet",
  checkpoint_departed: "Losgefahren",
  checkpoint_arrived_load: "An der Ladestelle",
  checkpoint_loaded: "Gut beladen",
  checkpoint_arrived_unload: "An der Entladestelle",
  checkpoint_done: "Umzug abgeschlossen",
};
const ROLE_TEXT: Record<string, string> = { kunde: "Kunde", logist: "Disponent", driver: "Fahrer", finance: "Buchhaltung", admin: "Admin" };

const FIELD_TEXT: Record<string, string> = {
  volumeM3: "Volumen", floorsFrom: "Etage (von)", floorsTo: "Etage (nach)",
  boxes: "Kartons", kitchen: "Küche", hvzZones: "HVZ", extraCrew: "Träger",
  packHours: "Verpackung, Std.", furnitureItems: "Möbel", elevatorFrom: "Aufzug (von)",
  elevatorTo: "Aufzug (nach)", express: "Eilig", sharedLoad: "Beiladung",
};

function HistoryEntryDe({ at, role, action, details, actorName }: { at: number; role: string; action: string; details: string; actorName?: string | null }) {
  const d = (() => { try { return JSON.parse(details) as Record<string, unknown>; } catch { return {}; } })();
  let text = ACTION_TEXT[action] ?? action;
  if (action === "revision_proposed" && d.fields) {
    const fields = d.fields as Record<string, { from: unknown; to: unknown }>;
    const parts = Object.entries(fields).map(([k, v]) => `${FIELD_TEXT[k] ?? k}: ${String(v.from)} → ${String(v.to)}`);
    if (parts.length > 0) text += ` (${parts.join(", ")})`;
    if (typeof d.new_gross === "number") text += ` — neuer Preis ${fmt(d.new_gross)}`;
  }
  if (action === "revision_accepted" && typeof d.from_gross === "number" && typeof d.to_gross === "number") {
    text += `: ${fmt(d.from_gross)} → ${fmt(d.to_gross)}`;
  }
  if (action === "status_changed" && typeof d.to === "string") text += `: ${STATUS_LABEL[d.to] ?? d.to}`;
  const actorLabel = (() => {
    const roleText = ROLE_TEXT[role] ?? role;
    // actor_user_id=0 — System-Akteur (cron); Name fehlt in der DB
    if (!actorName) return roleText;
    return `${roleText} · ${actorName}`;
  })();
  const label = new Date(at * 1000).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <li className="border-b border-line pb-2">
      <span className="text-muted">{label} · {actorLabel}</span>
      <span className="ml-2">{text}</span>
    </li>
  );
}
