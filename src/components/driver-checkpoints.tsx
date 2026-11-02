"use client";

// №9 (@2244): чек-поинты рейса с геолокацией. Кнопки этапов: Выехал (с гео) →
// Прибыл на погрузку → Загрузка завершена → Прибыл на выгрузку → Переезд завершён.
// Геолокация запрашивается ТОЛЬКО при клике (не при входе) — navigator.geolocation.
// Локаль: locale prop ("ru" | "de"), тексты co-located — как availability-calendar.tsx.

import { useState, useTransition } from "react";
import { saveCheckpointAction } from "@/lib/actions";

type Cp = "departed" | "arrived_load" | "loaded" | "arrived_unload" | "done";

const STEPS: Array<{ cp: Cp; geo: boolean }> = [
  { cp: "departed", geo: true },
  { cp: "arrived_load", geo: true },
  { cp: "loaded", geo: false },
  { cp: "arrived_unload", geo: true },
  { cp: "done", geo: false },
];

const T = {
  ru: {
    steps: {
      departed: "Выехал",
      arrived_load: "Прибыл на погрузку",
      loaded: "Загрузка завершена",
      arrived_unload: "Прибыл на выгрузку",
      done: "Переезд завершён",
    },
    heading: "Отметки рейса",
    allDone: "✓ Все отметки проставлены — рейс завершён.",
    saving: "Сохраняю…",
    saveFailed: "Не удалось сохранить отметку.",
    geoHint: "Браузер запросит геолокацию — так диспетчер видит, где экипаж.",
  },
  de: {
    steps: {
      departed: "Losgefahren",
      arrived_load: "An der Ladestelle",
      loaded: "Beladung abgeschlossen",
      arrived_unload: "An der Entladestelle",
      done: "Umzug abgeschlossen",
    },
    heading: "Fahrtmarken",
    allDone: "✓ Alle Markierungen gesetzt — die Fahrt ist abgeschlossen.",
    saving: "Speichere…",
    saveFailed: "Markierung konnte nicht gespeichert werden.",
    geoHint: "Der Browser fragt die Geolokalisierung ab — so sieht die Disposition, wo die Crew ist.",
  },
} as const;

export function DriverCheckpoints({
  orderId,
  doneCheckpoints,
  locale = "ru",
}: {
  orderId: number;
  doneCheckpoints: string[];
  locale?: "ru" | "de";
}) {
  const t = T[locale];
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const done = new Set(doneCheckpoints);

  const submit = (cp: Cp, wantGeo: boolean): void => {
    setError("");
    startTransition(async () => {
      let lat: number | undefined;
      let lon: number | undefined;
      if (wantGeo && typeof navigator !== "undefined" && navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
          });
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
        } catch {
          // гео недоступно/отклонено — сохраняем чек-поинт без координат
        }
      }
      const res = await saveCheckpointAction(orderId, cp, lat, lon);
      if (!res.ok) setError(res.message ?? t.saveFailed);
    });
  };

  const next = STEPS.find((s) => !done.has(s.cp));
  if (!next) {
    return <p className="mt-3 text-sm text-trust">{t.allDone}</p>;
  }

  return (
    <div className="mt-3">
      <p className="mb-2 text-sm font-semibold">{t.heading}</p>
      <div className="mb-2 flex flex-wrap gap-1 text-xs">
        {STEPS.filter((s) => done.has(s.cp)).map((s) => (
          <span key={s.cp} className="chip chip-trust">✓ {t.steps[s.cp]}</span>
        ))}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => submit(next.cp, next.geo)}
        className="btn btn-primary w-full text-base"
      >
        {pending ? t.saving : t.steps[next.cp]}
        {next.geo && !pending ? " 📍" : ""}
      </button>
      {next.geo && <p className="mt-1 text-xs text-muted">{t.geoHint}</p>}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
