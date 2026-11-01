"use client";

// D10: форма правки заказа (клиент или логист). Патч параметров → proposeRevisionAction.
// Рендерится на /order/{ref} для владельца (kunde) или logist/admin, когда правки ещё возможны.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { proposeRevisionAction } from "@/lib/actions";

const FLOORS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export interface RevisionFormProps {
  orderId: number;
  role: "kunde" | "logist"; // kunde = владелец, logist = логист/админ
  current: {
    volumeM3: number; floorsFrom: number; floorsTo: number;
    elevatorFrom: boolean; elevatorTo: boolean;
    boxes: number; kitchen: boolean; furnitureItems: number;
    packHours: number; hvzZones: number; extraCrew: number;
    express: boolean; sharedLoad: boolean;
  };
  deadlineHint: string; // «правки возможны ещё ~3 дня» или «порог пройден»
  canRevise: boolean;
}

const F = (n: number): string => n.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

export function RevisionForm({ orderId, role, current, deadlineHint, canRevise }: RevisionFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();

  // Поля формы — обычное состояние внутри того же компонента (react-hooks/static-components)
  const [volume, setVolume] = useState(current.volumeM3);
  const [from, setFrom] = useState(current.floorsFrom);
  const [to, setTo] = useState(current.floorsTo);
  const [boxes, setBoxes] = useState(current.boxes);
  const [kitchen, setKitchen] = useState(current.kitchen);
  const [hvz, setHvz] = useState(current.hvzZones);
  const [reason, setReason] = useState("");

  function submit(patch: Record<string, unknown>, reasonText: string) {
    start(async () => {
      const r = await proposeRevisionAction({ orderId, patch: patch as never, reason: reasonText });
      if (r.ok) {
        // Успех переживает refresh через URL-баннер (?msg=revision_proposed) — UX @3180
        router.replace(`?msg=revision_proposed`, { scroll: false });
      } else {
        setOk(false);
        setMsg(r.message ?? "Ошибка.");
      }
    });
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-secondary h-9" onClick={() => setOpen((o) => !o)} disabled={!canRevise || pending}>
          {role === "kunde" ? "Изменить заказ" : "Предложить изменение"}
        </button>
        <span className="text-xs text-muted">{deadlineHint}</span>
      </div>
      {!canRevise && <p className="mt-1 text-xs text-muted">Правки закрыты: дедлайн пройден или статус не позволяет. Возможна только отмена.</p>}
      {msg && (
        <div
          role="status"
          className={`mt-2 rounded-base border px-3 py-2 text-sm ${ok ? "border-trust/40 bg-emerald-50" : "border-danger/30 bg-red-50"}`}
          style={{ animation: "msgIn 220ms cubic-bezier(0.23, 1, 0.32, 1) both" }}
        >
          {msg}
        </div>
      )}
      {open && canRevise && (
        <div
          className="mt-3 grid gap-3 rounded-container border border-line bg-surface p-4"
          style={{ animation: "panelIn 240ms cubic-bezier(0.23, 1, 0.32, 1) both" }}
        >
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Объём: {F(volume)} м³</span>
            <input type="range" min={1} max={55} step={0.5} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Этаж (откуда)</span>
              <select className="input-base" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
                {FLOORS.map((f) => <option key={f} value={f}>{f === 0 ? "Улица" : `${f}-й этаж`}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Этаж (куда)</span>
              <select className="input-base" value={to} onChange={(e) => setTo(Number(e.target.value))}>
                {FLOORS.map((f) => <option key={f} value={f}>{f === 0 ? "Улица" : `${f}-й этаж`}</option>)}
              </select>
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Коробки: {boxes}</span>
            <input type="range" min={0} max={200} step={5} value={boxes} onChange={(e) => setBoxes(Number(e.target.value))} />
          </label>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={kitchen} onChange={(e) => setKitchen(e.target.checked)} /> Сборка кухни
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Зоны запрета парковки (HVZ)</span>
            <select className="input-base" value={hvz} onChange={(e) => setHvz(Number(e.target.value))}>
              <option value={0}>Без HVZ</option>
              <option value={1}>1 зона</option>
              <option value={2}>2 зоны</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Причина (необязательно)</span>
            <input className="input-base" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200}
              placeholder={role === "kunde" ? "например: добавился диван" : "например: не хватает машины класса B"} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" disabled={pending}
              onClick={() => submit({ volumeM3: volume, floorsFrom: from, floorsTo: to, boxes, kitchen, hvzZones: hvz }, reason)}>
              {pending ? "Отправка…" : role === "kunde" ? "Запросить пересчёт" : "Предложить новую цену"}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}
