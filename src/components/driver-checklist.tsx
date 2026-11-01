// Чек-лист водителя (Э5, D6): план = order_lines kind=line, один факт-объём,
// подпись клиента текстом, заметки. INSERT-only через saveProtocolAction.
// Черновик в localStorage protocol_draft_{orderId} (D6.10).

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProtocolAction, type ProtocolResult } from "@/lib/actions";

interface Props {
  orderId: number;
  planM3: number;
  items: Array<{ key: string; label: string }>;
}

export function DriverChecklist({ orderId, planM3, items }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [factM3, setFactM3] = useState(String(planM3));
  const [notes, setNotes] = useState("");
  const [signature, setSignature] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const it of items) init[it.key] = true;
    return init;
  });
  const draftKey = `protocol_draft_${orderId}`;
  const restored = useRef(false);

  // D6.10: восстановление черновика после перезагрузки
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
          const d = JSON.parse(raw) as { factM3?: string; notes?: string; signature?: string; checked?: Record<string, boolean> };
          if (d.factM3 !== undefined) setFactM3(d.factM3);
          if (d.notes !== undefined) setNotes(d.notes);
          if (d.signature !== undefined) setSignature(d.signature);
          if (d.checked) setChecked((prev) => ({ ...prev, ...d.checked }));
        }
      } catch { /* демо: пустой черновик ок */ }
    }, 0);
    return () => clearTimeout(t);
  }, [draftKey]);

  // Сохранение черновика при изменении
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify({ factM3, notes, signature, checked })); } catch { /* noop */ }
    }, 300);
    return () => clearTimeout(t);
  }, [factM3, notes, signature, checked, draftKey]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res: ProtocolResult = await saveProtocolAction({
        orderId,
        factM3: Number(factM3.replace(",", ".")),
        items: items.map((it) => ({ key: it.key, label: it.label, checked: !!checked[it.key] })),
        notes,
        signature,
      });
      if (res.ok) {
        try { localStorage.removeItem(draftKey); } catch { /* noop */ }
        router.refresh();
      } else {
        setError(res.message ?? "Ошибка сохранения.");
      }
    });
  }

  const allChecked = items.every((it) => checked[it.key]);

  return (
    <div className="mt-4 rounded-container border border-line bg-white p-4">
      <p className="mb-3 font-semibold">Чек-лист загрузки</p>

      <ul className="mb-4 grid gap-2">
        {items.map((it) => (
          <li key={it.key}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 accent-orange-600"
                checked={!!checked[it.key]}
                onChange={(e) => setChecked((c) => ({ ...c, [it.key]: e.target.checked }))}
              />
              <span>{it.label}</span>
            </label>
          </li>
        ))}
      </ul>

      <label className="mb-1 block text-sm font-medium" htmlFor="fact">
        Фактический объём, м³ <span className="text-muted">(план: {planM3} м³)</span>
      </label>
      <input
        id="fact"
        className="input-base mb-3"
        inputMode="decimal"
        value={factM3}
        onChange={(e) => setFactM3(e.target.value)}
      />

      <label className="mb-1 block text-sm font-medium" htmlFor="notes">Заметки (необязательно)</label>
      <textarea
        id="notes"
        className="input-base mb-3"
        rows={2}
        maxLength={2000}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <label className="mb-1 block text-sm font-medium" htmlFor="sig">
        Подпись клиента <span className="text-muted">(ФИО, подтверждает приёмку груза)</span>
      </label>
      <input
        id="sig"
        className="input-base mb-3"
        value={signature}
        maxLength={200}
        onChange={(e) => setSignature(e.target.value)}
      />

      {error && <p className="mb-3 rounded-container bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}

      <button className="btn btn-primary w-full text-base" type="button" disabled={pending || !signature.trim()} onClick={submit}>
        {pending ? "Сохранение…" : "Подписать протокол"}
      </button>
      <p className="mt-2 text-xs text-muted">
        Протокол составляется один раз, изменить его нельзя. {allChecked ? "Все позиции подтверждены." : "Есть непроверённые позиции."}
      </p>
    </div>
  );
}
