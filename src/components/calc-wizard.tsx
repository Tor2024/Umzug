"use client";

// Калькулятор (Э3): 3 шага — Маршрут → Объём → Услуги.
// Клиентская цена = черновик (D4.1); финал считает сервер в createOrderAction.
// Гонки debounce: request-id guard (D4.6); double-submit: кнопка блокируется (D4.4).

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createOrderAction, type OrderInput } from "@/lib/actions";
import { calculateQuote, DEFAULT_TARIFFS, type MoveConfig } from "@/lib/pricing";
import RouteMapLazy from "@/components/route-map-lazy";
import { AvailabilityCalendar } from "@/components/availability-calendar";

const fmt = (cents: number): string =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(cents / 100);

interface RouteState {
  loading: boolean;
  km: number;
  minutes: number;
  provider: string;
  geometry?: [number, number][];
  error?: string;
}

const STEPS = ["Маршрут", "Объём", "Услуги"] as const;

export function CalcWizard({ loggedIn, tariffs = DEFAULT_TARIFFS }: { loggedIn: boolean; tariffs?: typeof DEFAULT_TARIFFS }) {
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

  // Холостой возврат машины на базу (требование пользователя: полный возврат в клиентской цене).
  // Пересчитывается при изменении адреса выгрузки; debounce общий с основным маршрутом.
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
          if (reqId.current === id) setRoute({ loading: false, km: 0, minutes: 0, provider: "", error: "Сервис маршрутов недоступен." });
        });
      // Возврат: адрес выгрузки → база компании (SITE.address на сервере)
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
  // Задача 6: авто-коэффициент загрузки выбранной даты (из календаря)
  const [autoLoadPct, setAutoLoadPct] = useState(0);

  // Черновой расчёт на клиенте (официальная цена — после сабмита, D4.13)
  const draft = useMemo<MoveConfig>(() => ({
    vehicleClass: "B", classForced: false,
    volumeM3, distanceKm: route.km, durationMin: route.minutes || undefined,
    floorsFrom, floorsTo, elevatorFrom, elevatorTo,
    boxes, kitchen, furnitureItems, packHours, hvzZones, extraCrew,
    moveDate, express, sharedLoad,
    autoLoadPct: autoLoadPct || undefined,
    returnKm: returnKm > 0 ? returnKm : undefined,
  }), [volumeM3, route.km, route.minutes, floorsFrom, floorsTo, elevatorFrom, elevatorTo, boxes, kitchen, furnitureItems, packHours, hvzZones, extraCrew, moveDate, express, sharedLoad, autoLoadPct, returnKm]);

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
      boxes, kitchen, furnitureItems, packHours, hvzZones, extraCrew,
      moveDate, express, sharedLoad,
      vehicleClass: "A", // «авто» — сервер выберет по объёму
      classForced: false,
    };
    startTransition(async () => {
      const res = await createOrderAction(input);
      if (res.ok && res.ref) {
        router.push(`/order/${res.ref}`);
      } else if (res.error === "auth") {
        router.push(`/login?next=${encodeURIComponent("/calc")}`);
      } else {
        setErr(res.message ?? "Не удалось создать заявку.");
      }
    });
  };

  const floorOptions = Array.from({ length: 11 }, (_, i) => ({ v: i, l: i === 0 ? "Этаж 0 (улица)" : `${i}-й этаж` }));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* Основная колонка: шаги */}
      <div className="card p-5 sm:p-6">
        {/* Шаги */}
        <ol className="mb-6 flex items-center gap-2 text-sm" aria-label="Шаги">
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
              <span className="font-medium">Откуда</span>
              <input className="input-base" placeholder="Город, улица, дом" value={fromText} onChange={(e) => setFromText(e.target.value)} maxLength={200} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Куда</span>
              <input className="input-base" placeholder="Город, улица, дом" value={toText} onChange={(e) => setToText(e.target.value)} maxLength={200} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Дата переезда</span>
              <input className="input-base" type="date" value={moveDate} onChange={(e) => { setMoveDate(e.target.value); setAutoLoadPct(0); }} />
              <span className="text-xs text-muted">Воскресенья и праздники недоступны (§ 9 ArbZG).</span>
            </label>
            <AvailabilityCalendar
              loggedIn={loggedIn}
              value={moveDate}
              onChange={(iso) => setMoveDate(iso)}
              onSelectDay={(d) => setAutoLoadPct(d.autoLoadPct ?? 0)}
            />
            <div aria-live="polite" className="rounded-container border border-line bg-surface px-4 py-3 text-sm">
              {route.loading && <span className="text-muted">Считаем маршрут…</span>}
              {!route.loading && route.km > 0 && (
                <span>Расстояние: <b>{route.km} км</b> · ~{Math.round(route.minutes / 60 * 10) / 10} ч <span className="text-muted">({route.provider === "google" ? "Google Maps" : "OSRM/OSM"})</span></span>
              )}
              {!route.loading && route.km === 0 && route.error && <span className="text-danger">{route.error}</span>}
              {!route.loading && route.km === 0 && !route.error && <span className="text-muted">Введите адреса, и расстояние подставится само.</span>}
            </div>
            {route.geometry && route.geometry.length >= 2 && (
              <RouteMapLazy geometry={route.geometry} fromText={fromText} toText={toText} height={220} />
            )}
            <button className="btn btn-primary" onClick={() => setStep(1)} disabled={route.km <= 0}>
              Далее: объём
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Объём вещей: <b>{volumeM3} м³</b></span>
              <input type="range" min={1} max={55} step={0.5} value={volumeM3} onChange={(e) => setVolumeM3(Number(e.target.value))} />
              <span className="text-xs text-muted">Ориентир: 1-комн. ≈ 12–15 м³, 2-комн. ≈ 20–25 м³, дом ≈ 40+ м³.</span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Этаж (откуда)</span>
                <select className="input-base" value={floorsFrom} onChange={(e) => setFloorsFrom(Number(e.target.value))}>
                  {floorOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <label className="mt-1 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={elevatorFrom} onChange={(e) => setElevatorFrom(e.target.checked)} />
                  Лифт есть
                </label>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Этаж (куда)</span>
                <select className="input-base" value={floorsTo} onChange={(e) => setFloorsTo(Number(e.target.value))}>
                  {floorOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <label className="mt-1 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={elevatorTo} onChange={(e) => setElevatorTo(e.target.checked)} />
                  Лифт есть
                </label>
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Картонов: <b>{boxes}</b></span>
              <input type="range" min={0} max={200} step={5} value={boxes} onChange={(e) => setBoxes(Number(e.target.value))} />
            </label>
            <div className="flex gap-2">
              <button className="btn btn-outline" onClick={() => setStep(0)}>Назад</button>
              <button className="btn btn-primary" onClick={() => setStep(2)}>Далее: услуги</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <div className="grid gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={kitchen} onChange={(e) => setKitchen(e.target.checked)} />
                Разборка и сборка кухни (комплект)
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Мебели на разбор/сбор: <b>{furnitureItems}</b></span>
                <input type="range" min={0} max={20} value={furnitureItems} onChange={(e) => setFurnitureItems(Number(e.target.value))} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Упаковка: <b>{packHours} ч</b></span>
                <input type="range" min={0} max={12} value={packHours} onChange={(e) => setPackHours(Number(e.target.value))} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Зоны запрета парковки (HVZ): <b>{hvzZones}</b></span>
                <input type="range" min={0} max={2} value={hvzZones} onChange={(e) => setHvzZones(Number(e.target.value))} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Доп. грузчики: <b>+{extraCrew}</b></span>
                <input type="range" min={0} max={3} value={extraCrew} onChange={(e) => setExtraCrew(Number(e.target.value))} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={express} onChange={(e) => setExpress(e.target.checked)} />
                Срочно (в течение 48 ч) — +25 %
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sharedLoad} onChange={(e) => setSharedLoad(e.target.checked)} />
                Догруз (делю машину) — скидка 15 %
              </label>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-outline" onClick={() => setStep(1)}>Назад</button>
              <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
                {pending ? "Отправляем…" : "Отправить заявку"}
              </button>
            </div>
            {!loggedIn && (
              <p className="text-sm text-muted">
                Чтобы отправить заявку, <Link className="text-accent underline" href="/login?next=/calc">войдите</Link> или{" "}
                <Link className="text-accent underline" href="/register">зарегистрируйтесь</Link>. Расчёт доступен без входа.
              </p>
            )}
            {err && <p className="text-sm text-danger" role="alert">{err}</p>}
          </div>
        )}
      </div>

      {/* Липкая смета (черновик) */}
      <aside className="card h-fit p-5 lg:sticky lg:top-6">
        <h2 className="mb-3 font-semibold">Предварительный расчёт</h2>
        {quote ? (
          <dl className="grid gap-1.5 text-sm">
            {quote.lines.map((l) => (
              <div key={l.key} className="flex justify-between gap-3">
                <dt className="text-muted">{l.label}</dt>
                <dd className="tabular-nums">{fmt(l.amount)}</dd>
              </div>
            ))}
            {quote.discount > 0 && (
              <div className="flex justify-between gap-3 text-trust">
                <dt>Скидка (догруз)</dt>
                <dd className="tabular-nums">−{fmt(quote.discount)}</dd>
              </div>
            )}
            {quote.multiplierPct !== 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Коэффициенты</dt>
                <dd className="tabular-nums">{quote.multiplierPct > 0 ? "+" : ""}{quote.multiplierPct} %</dd>
              </div>
            )}
            <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
              <dt>Итого (брутто)</dt>
              <dd className="tabular-nums">{fmt(quote.gross)}</dd>
            </div>
            <div className="flex justify-between text-muted">
              <dt>Аванс {Math.round(tariffs.depositPct)} %</dt>
              <dd className="tabular-nums">{fmt(quote.deposit)}</dd>
            </div>
            {quote.workHours > 10 && (
              <p className="mt-1 rounded-container bg-surface-2 px-3 py-2 text-xs">
                Смена длиннее 10 ч — назначим второго водителя.
              </p>
            )}
          </dl>
        ) : (
          <p className="text-sm text-muted">Заполните шаг «Маршрут».</p>
        )}
        <p className="mt-3 text-xs text-muted">
          Цена предварительная. После отправки заявки расчёт фиксируется на {tariffs.quoteValidDays} дней.
        </p>
      </aside>
    </div>
  );
}
