"use client";

// №9 (@2244): чек-поинты рейса с геолокацией. Кнопки этапов: Выехал (с гео) →
// Прибыл на погрузку → Загрузка завершена → Прибыл на выгрузку → Переезд завершён.
// Геолокация запрашивается ТОЛЬКО при клике (не при входе) — navigator.geolocation.

import { useState, useTransition } from "react";
import { saveCheckpointAction } from "@/lib/actions";

const STEPS: Array<{ cp: "departed" | "arrived_load" | "loaded" | "arrived_unload" | "done"; label: string; geo: boolean }> = [
  { cp: "departed", label: "Выехал", geo: true },
  { cp: "arrived_load", label: "Прибыл на погрузку", geo: true },
  { cp: "loaded", label: "Загрузка завершена", geo: false },
  { cp: "arrived_unload", label: "Прибыл на выгрузку", geo: true },
  { cp: "done", label: "Переезд завершён", geo: false },
];

export function DriverCheckpoints({
  orderId,
  doneCheckpoints,
}: {
  orderId: number;
  doneCheckpoints: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const done = new Set(doneCheckpoints);

  const submit = (cp: "departed" | "arrived_load" | "loaded" | "arrived_unload" | "done", wantGeo: boolean): void => {
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
      if (!res.ok) setError(res.message ?? "Не удалось сохранить отметку.");
    });
  };

  const next = STEPS.find((s) => !done.has(s.cp));
  if (!next) {
    return <p className="mt-3 text-sm text-trust">✓ Все отметки проставлены — рейс завершён.</p>;
  }

  return (
    <div className="mt-3">
      <p className="mb-2 text-sm font-semibold">Отметки рейса</p>
      <div className="mb-2 flex flex-wrap gap-1 text-xs">
        {STEPS.filter((s) => done.has(s.cp)).map((s) => (
          <span key={s.cp} className="chip chip-trust">✓ {s.label}</span>
        ))}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => submit(next.cp, next.geo)}
        className="btn btn-primary w-full text-base"
      >
        {pending ? "Сохраняю…" : next.label}
        {next.geo && !pending ? " 📍" : ""}
      </button>
      {next.geo && <p className="mt-1 text-xs text-muted">Браузер запросит геолокацию — так диспетчер видит, где экипаж.</p>}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
