"use client";

// DE-версия калькулятора (Э3): точная копия calc-wizard.tsx с немецкими текстами.
// Логика/экшены общие (см. @b14@): createOrderAction тот же, редирект /order/{ref}.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createOrderAction, type OrderInput } from "@/lib/actions";
import { calculateQuote, DEFAULT_TARIFFS, type MoveConfig } from "@/lib/pricing";
import RouteMapLazy from "@/components/route-map-lazy";
import { AvailabilityCalendar } from "@/components/availability-calendar";

const fmt = (cents: number): string =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(cents / 100);

interface RouteState {
  loading: boolean;
  km: number;
  minutes: number;
  provider: string;
  geometry?: [number, number][];
  error?: string;
}

const STEPS = ["Strecke", "Volumen", "Leistungen"] as const;

export function CalcWizardDe({ loggedIn, tariffs = DEFAULT_TARIFFS }: { loggedIn: boolean; tariffs?: typeof DEFAULT_TARIFFS }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();

  // Шаг 1: маршрут
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [moveDate, setMoveDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    if (d.getDay() === 0) d.setDate(d.getDate() + 1); // воскресенье → понедельник
    return d.toISOString().slice(0, 10);
  });
  const [route, setRoute] = useState<RouteState>({ loading: false, km: 0, minutes: 0, provider: "" });
  const reqId = useRef(0);

  const [returnKm, setReturnKm] = useState(0);
  const returnReqId = useRef(0);

  useEffect(() => {
    if (fromText.trim().length < 3 || toText.trim().length < 3) {
      const t = setTimeout(() => {
        setRoute({ loading: false, km: 0, minutes: 0, provider: "" });
        setReturnKm(0);
      }, 0);
      return () => clearTimeout(t);
    }
    const id = ++reqId.current;
    const rid = ++returnReqId.current;
    const t = setTimeout(() => {
      setRoute((r) => ({ ...r, loading: true }));
      fetch(`/api/route?from=${encodeURIComponent(fromText)}&to=${encodeURIComponent(toText)}`)
        .then((r) => r.json())
        .then((j: { km?: number; minutes?: number; provider?: string; geometry?: [number, number][]; error?: string }) => {
          if (reqId.current !== id) return; // устаревший ответ игнорируем (D4.6)
          setRoute({ loading: false, km: j.km ?? 0, minutes: j.minutes ?? 0, provider: j.provider ?? "", geometry: j.geometry, error: j.error });
        })
        .catch(() => {
          if (reqId.current === id) setRoute({ loading: false, km: 0, minutes: 0, provider: "", error: "Routendienst nicht verfügbar." });
        });
      fetch(`/api/route/return?to=${encodeURIComponent(toText)}`)
        .then((r) => r.json())
        .then((j: { km?: number }) => {
          if (returnReqId.current !== rid) return;
          setReturnKm(j.km ?? 0);
        })
        .catch(() => {
          if (returnReqId.current === rid) setReturnKm(0);
        });
    }, 500);
    return () => clearTimeout(t);
  }, [fromText, toText]);

  // Шаг 2: объём
  const [volumeM3, setVolumeM3] = useState(20);
  const [floorsFrom, setFloorsFrom] = useState(0);
  const [floorsTo, setFloorsTo] = useState(0);
  const [elevatorFrom, setElevatorFrom] = useState(false);
  const [elevatorTo, setElevatorTo] = useState(false);
  const [boxes, setBoxes] = useState(0);

  // Шаг 3: услуги
  const [kitchen, setKitchen] = useState(false);
  const [furnitureItems, setFurnitureItems] = useState(0);
  const [packHours, setPackHours] = useState(0);
  const [hvzZones, setHvzZones] = useState(0);
  const [extraCrew, setExtraCrew] = useState(0);
  const [express, setExpress] = useState(false);
  const [sharedLoad, setSharedLoad] = useState(false);
  const [autoLoadPct, setAutoLoadPct] = useState(0);
  const [startTime, setStartTime] = useState("08:00");
  const [selfPack, setSelfPack] = useState(false);
  const [specialRequests, setSpecialRequests] = useState("");

  const effectivePackHours = selfPack ? 0 : packHours;

  const draft = useMemo<MoveConfig>(() => ({
    vehicleClass: "B", classForced: false,
    volumeM3, distanceKm: route.km, durationMin: route.minutes || undefined,
    floorsFrom, floorsTo, elevatorFrom, elevatorTo,
    boxes, kitchen, furnitureItems, packHours: effectivePackHours, hvzZones, extraCrew,
    moveDate, express, sharedLoad,
    autoLoadPct: autoLoadPct || undefined,
    returnKm: returnKm > 0 ? returnKm : undefined,
  }), [volumeM3, route.km, route.minutes, floorsFrom, floorsTo, elevatorFrom, elevatorTo, boxes, kitchen, furnitureItems, effectivePackHours, hvzZones, extraCrew, moveDate, express, sharedLoad, autoLoadPct, returnKm]);

  const quote = useMemo(() => {
    try {
      return calculateQuote(draft, tariffs);
    } catch {
      return null;
    }
  }, [draft, tariffs]);

  const canSubmit = loggedIn && !route.loading && route.km > 0 && !pending && !!quote;

  const [err, setErr] = useState("");

  const submit = (): void => {
    if (!canSubmit) return;
    setErr("");
    const input: OrderInput = {
      fromText, toText, volumeM3,
      floorsFrom, floorsTo, elevatorFrom, elevatorTo,
      boxes, kitchen, furnitureItems, packHours: effectivePackHours, hvzZones, extraCrew,
      moveDate, express, sharedLoad,
      vehicleClass: "A",
      classForced: false,
      startTime,
      selfPack,
      specialRequests: specialRequests.trim() || undefined,
    };
    startTransition(async () => {
      const res = await createOrderAction(input);
      if (res.ok && res.ref) {
        router.push(`/order/${res.ref}`);
      } else if (res.error === "auth") {
        router.push(`/de/login?next=${encodeURIComponent("/de/calc")}`);
      } else {
        setErr(res.message ?? "Anfrage konnte nicht erstellt werden.");
      }
    });
  };

  const floorOptions = Array.from({ length: 11 }, (_, i) => ({ v: i, l: i === 0 ? "Etage 0 (Straße)" : `${i}. Etage` }));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* Основная колонка: шаги */}
      <div className="card p-5 sm:p-6">
        <ol className="mb-6 flex items-center gap-2 text-sm" aria-label="Schritte">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  i === step ? "bg-primary text-white" : i < step ? "bg-trust text-white" : "bg-surface-2 text-ink"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </span>
              <span className={i === step ? "font-semibold" : "text-muted"}>{s}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-line" aria-hidden />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Von</span>
              <input className="input-base" placeholder="Stadt, Straße, Hausnummer" value={fromText} onChange={(e) => setFromText(e.target.value)} maxLength={200} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Nach</span>
              <input className="input-base" placeholder="Stadt, Straße, Hausnummer" value={toText} onChange={(e) => setToText(e.target.value)} maxLength={200} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Umzugsdatum</span>
              <input className="input-base" type="date" value={moveDate} onChange={(e) => { setMoveDate(e.target.value); setAutoLoadPct(0); }} />
              <span className="text-xs text-muted">Sonntage und Feiertage nicht verfügbar (§ 9 ArbZG).</span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Beginn der Beladung</span>
              <select className="input-base" value={startTime} onChange={(e) => setStartTime(e.target.value)}>
                {Array.from({ length: 11 }, (_, i) => {
                  const h = 7 + i;
                  return <option key={h} value={`${String(h).padStart(2, "0")}:00`}>{`${String(h).padStart(2, "0")}:00`}</option>;
                })}
              </select>
              <span className="text-xs text-muted">Das Team kommt zu dieser Zeit an (inkl. Anfahrt des Fahrzeugs).</span>
            </label>
            <AvailabilityCalendar
              loggedIn={loggedIn}
              value={moveDate}
              onChange={(iso) => setMoveDate(iso)}
              onSelectDay={(d) => setAutoLoadPct(d.autoLoadPct ?? 0)}
              locale="de"
            />
            <div aria-live="polite" className="rounded-container border border-line bg-surface px-4 py-3 text-sm">
              {route.loading && <span className="text-muted">Route wird berechnet…</span>}
              {!route.loading && route.km > 0 && (
                <span>Entfernung: <b>{route.km} km</b> · ~{Math.round(route.minutes / 60 * 10) / 10} Std. <span className="text-muted">({route.provider === "google" ? "Google Maps" : "OSRM/OSM"})</span></span>
              )}
              {!route.loading && route.km === 0 && route.error && <span className="text-danger">{route.error}</span>}
              {!route.loading && route.km === 0 && !route.error && <span className="text-muted">Adressen eingeben — die Entfernung wird automatisch berechnet.</span>}
            </div>
            {route.geometry && route.geometry.length >= 2 && (
              <RouteMapLazy geometry={route.geometry} fromText={fromText} toText={toText} height={220} locale="de" />
            )}
            <button className="btn btn-primary min-w-16" onClick={() => setStep(1)} disabled={route.km <= 0}>
              Weiter: Volumen
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Volumen: <b>{volumeM3} m³</b></span>
              <input type="range" min={1} max={55} step={0.5} value={volumeM3} onChange={(e) => setVolumeM3(Number(e.target.value))} />
              <span className="text-xs text-muted">Orientierung: 1-Zi. ≈ 12–15 m³, 2-Zi. ≈ 20–25 m³, Haus ≈ 40+ m³.</span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Etage (Von)</span>
                <select className="input-base" value={floorsFrom} onChange={(e) => setFloorsFrom(Number(e.target.value))}>
                  {floorOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <label className="mt-1 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={elevatorFrom} onChange={(e) => setElevatorFrom(e.target.checked)} />
                  Aufzug vorhanden
                </label>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Etage (Nach)</span>
                <select className="input-base" value={floorsTo} onChange={(e) => setFloorsTo(Number(e.target.value))}>
                  {floorOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <label className="mt-1 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={elevatorTo} onChange={(e) => setElevatorTo(e.target.checked)} />
                  Aufzug vorhanden
                </label>
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Kartons: <b>{boxes}</b></span>
              <input type="range" min={0} max={200} step={5} value={boxes} onChange={(e) => setBoxes(Number(e.target.value))} />
            </label>
            <div className="flex gap-2">
              <button className="btn btn-outline min-w-16" onClick={() => setStep(0)}>Zurück</button>
              <button className="btn btn-primary min-w-16" onClick={() => setStep(2)}>Weiter: Leistungen</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <div className="grid gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={kitchen} onChange={(e) => setKitchen(e.target.checked)} />
                Küche demontieren und montieren (Komplettpaket)
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Möbel zum Demontieren/Aufbauen: <b>{furnitureItems}</b></span>
                <input type="range" min={0} max={20} value={furnitureItems} onChange={(e) => setFurnitureItems(Number(e.target.value))} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Einpacken: <b>{effectivePackHours} Std.</b></span>
                <input type="range" min={0} max={12} value={packHours} disabled={selfPack} onChange={(e) => setPackHours(Number(e.target.value))} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selfPack} onChange={(e) => setSelfPack(e.target.checked)} />
                Wir packen selbst — kein Einpackservice nötig
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Besondere Wünsche beim Be-/Entladen <span className="font-normal text-muted">(optional, klärt der Disponent)</span></span>
                <textarea
                  className="input-base min-h-20"
                  maxLength={500}
                  placeholder="Z. B.: empfindliche Möbel, enge Treppe, Transport in den 3. Stock ohne Aufzug, Klavier…"
                  value={specialRequests}
                  onChange={(e) => setSpecialRequests(e.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Halteverbotszonen (HVZ): <b>{hvzZones}</b></span>
                <input type="range" min={0} max={2} value={hvzZones} onChange={(e) => setHvzZones(Number(e.target.value))} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Zusätzliche Träger: <b>+{extraCrew}</b></span>
                <input type="range" min={0} max={3} value={extraCrew} onChange={(e) => setExtraCrew(Number(e.target.value))} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={express} onChange={(e) => setExpress(e.target.checked)} />
                Eilig (innerhalb von 48 Std.) — +25 %
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sharedLoad} onChange={(e) => setSharedLoad(e.target.checked)} />
                Beiladung (Fahrzeug teilen) — 15 % Rabatt
              </label>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-outline min-w-16" onClick={() => setStep(1)}>Zurück</button>
              <button className="btn btn-primary min-w-28" onClick={submit} disabled={!canSubmit}>
                {pending ? "Wird gesendet…" : "Angebot senden"}
              </button>
            </div>
            {!loggedIn && (
              <p className="text-sm text-muted">
                Um die Anfrage zu senden, <Link className="text-accent underline" href="/de/login?next=/de/calc">melden Sie sich an</Link> oder{" "}
                <Link className="text-accent underline" href="/de/register">registrieren Sie sich</Link>. Die Berechnung ist ohne Anmeldung möglich.
              </p>
            )}
            {err && <p className="text-sm text-danger" role="alert">{err}</p>}
          </div>
        )}
      </div>

      {/* Липкая смета (черновик) */}
      <aside className="card h-fit p-5 lg:sticky lg:top-6">
        <h2 className="mb-3 font-semibold">Vorläufige Berechnung</h2>
        {quote ? (
          <dl className="grid gap-1.5 text-sm">
            {quote.lines.map((l) => (
              <div key={l.key} className="flex justify-between gap-3">
                <dt className="text-muted overflow-wrap-anywhere">{l.key === "base" ? `Grundpreis (${l.label.replace(/^База \((.+)\)$/, "$1")})` : l.label}</dt>
                <dd className="tabular-nums">{fmt(l.amount)}</dd>
              </div>
            ))}
            {quote.discount > 0 && (
              <div className="flex justify-between gap-3 text-trust">
                <dt>Rabatt (Beiladung)</dt>
                <dd className="tabular-nums">−{fmt(quote.discount)}</dd>
              </div>
            )}
            {quote.multiplierPct !== 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Faktoren</dt>
                <dd className="tabular-nums">{quote.multiplierPct > 0 ? "+" : ""}{quote.multiplierPct} %</dd>
              </div>
            )}
            <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
              <dt>Gesamt (brutto)</dt>
              <dd className="tabular-nums">{fmt(quote.gross)}</dd>
            </div>
            <div className="flex justify-between text-muted">
              <dt>Anzahlung {Math.round(tariffs.depositPct)} %</dt>
              <dd className="tabular-nums">{fmt(quote.deposit)}</dd>
            </div>
            {quote.workHours > 10 && (
              <p className="mt-1 rounded-container bg-surface-2 px-3 py-2 text-xs">
                Schicht länger als 10 Std. — wir planen einen zweiten Fahrer ein.
              </p>
            )}
          </dl>
        ) : (
          <p className="text-sm text-muted">Bitte Schritt „Strecke“ ausfüllen.</p>
        )}
        <p className="mt-3 text-xs text-muted">
          Preis vorläufig. Nach dem Senden der Anfrage wird die Berechnung für {tariffs.quoteValidDays} Tage festgehalten.
        </p>
      </aside>
    </div>
  );
}
