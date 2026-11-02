"use client";

// D11: Календарь доступности (клиентский). Цвета: free=зелёный, partial=жёлтый
// (1 машина — предупреждение, разрешено), busy=красный, closed=серый (вс/праздник/прошлое).
// Переключение месяцев в границах [сегодня, +3 мес]. Пустой месяц → nearestFree подсказка.

import { useEffect, useState } from "react";
import type { MonthAvailability, DayStatus, DayAvailability } from "@/lib/availability";

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

const STATUS_CLASS: Record<DayStatus, string> = {
  free: "bg-emerald-100 text-emerald-900 border-emerald-300 hover:border-accent",
  partial: "bg-amber-100 text-amber-900 border-amber-300 hover:border-accent",
  busy: "bg-red-100 text-red-400 border-red-200 cursor-not-allowed line-through",
  closed: "bg-surface-2 text-muted/50 border-line cursor-not-allowed",
};

export interface AvailabilityCalendarProps {
  loggedIn: boolean;
  volumeM3?: number;      // фильтр по классу (шаг 1 — undefined)
  needsSecond?: boolean;
  value: string;          // ISO выбранной даты
  onChange: (iso: string) => void;
  /** Задача 6: колбэк с данными выбранного дня (для авто-коэффициента загрузки) */
  onSelectDay?: (d: DayAvailability) => void;
}

export function AvailabilityCalendar({ loggedIn, volumeM3, needsSecond, value, onChange, onSelectDay }: AvailabilityCalendarProps) {
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<MonthAvailability | null>(null);
  const [nearestFree, setNearestFree] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!loggedIn) return;
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ month });
      if (volumeM3 !== undefined) params.set("volume", String(volumeM3));
      if (needsSecond) params.set("needsSecond", "1");
      fetch(`/api/availability?${params}`)
        .then((r) => r.json())
        .then((j: (MonthAvailability & { nearestFree?: string | null }) | { error: string }) => {
          if ("error" in j) return;
          setData(j);
          setNearestFree(j.nearestFree ?? null);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(t);
  }, [loggedIn, month, volumeM3, needsSecond]);

  if (!loggedIn) {
    return (
      <p className="rounded-container border border-line bg-surface px-4 py-3 text-sm text-muted">
        Войдите в аккаунт — увидите, какие дни ещё свободны.
      </p>
    );
  }

  if (!data) {
    return <div className="h-40 animate-pulse rounded-container bg-surface-2" aria-label="Загрузка календаря" />;
  }

  const [y, m] = data.month.split("-").map(Number);
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Пн=0
  const days = Object.entries(data.dates).sort(([a], [b]) => a.localeCompare(b));
  const canPrev = data.month > data.minMonth;
  const canNext = data.month < data.maxMonth;
  const freeCount = days.filter(([, d]) => d.status === "free" || d.status === "partial").length;

  const label = (iso: string, d: (typeof days)[0][1]) => {
    if (d.status === "closed") return iso < data.today ? "прошло" : data.holidays.includes(iso) ? "праздник" : "воскресенье";
    if (d.status === "busy") return "занято";
    if (d.pendingOrders > 0) return `${d.pendingOrders} заявк. в очереди`;
    if (d.status === "partial") return "1 машина";
    return "свободно";
  };

  return (
    <div className="rounded-container border border-line bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="btn btn-outline h-8 w-8" disabled={!canPrev}
          onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">‹</button>
        <span className="font-semibold">{MONTH_NAMES[m - 1]} {y}</span>
        <button type="button" className="btn btn-outline h-8 w-8" disabled={!canNext}
          onClick={() => shiftMonth(1)} aria-label="Следующий месяц">›</button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-muted">
        {DAY_NAMES.map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstDow }, (_, i) => <span key={`pad-${i}`} />)}
        {days.map(([iso, d]) => {
          const selectable = d.status === "free" || d.status === "partial";
          const selected = value === iso;
          return (
            <button
              key={iso} type="button"
              disabled={!selectable}
              aria-pressed={selected}
              title={`${iso}: ${label(iso, d)}`}
              onClick={() => { onChange(iso); onSelectDay?.(d); }}
              className={`flex h-10 flex-col items-center justify-center rounded-base border text-sm ${STATUS_CLASS[d.status]} ${selected ? "ring-2 ring-accent" : ""}`}
            >
              <span className="leading-none">{Number(iso.slice(8))}</span>
              {d.status === "partial" && <span className="text-[9px] leading-none">1 маш.</span>}
              {d.pendingOrders > 0 && d.status !== "closed" && <span className="text-[9px] leading-none">{d.pendingOrders}оч</span>}
            </button>
          );
        })}
      </div>
      {freeCount === 0 && !loading && (
        <p className="mt-3 rounded-container bg-orange-50 px-3 py-2 text-sm text-orange-900" role="status">
          В этом месяце всё занято{nearestFree ? ` — ближайший свободный день: ${nearestFree}` : ", свяжитесь с нами"}.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-emerald-400" /> свободно</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-amber-400" /> 1 машина</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-red-300" /> занято</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-surface-2 ring-1 ring-line" /> вс/праздник</span>
      </div>
    </div>
  );

  function shiftMonth(delta: number) {
    const d = new Date(data!.month + "-01T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + delta);
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
}
