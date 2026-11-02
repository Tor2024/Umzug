"use client";

// Кнопки решения по правке (D10): «Принять правку» / «Отклонить».
// Успех переживает refresh через URL-баннер (?msg=revision_accepted|revision_rejected) — UX @3180.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptRevisionAction, rejectRevisionAction } from "@/lib/actions";

const T = {
  ru: { saving: "Сохранение…", accept: "Принять правку", reject: "Отклонить", error: "Ошибка." },
  de: { saving: "Speichern…", accept: "Änderung annehmen", reject: "Ablehnen", error: "Fehler." },
} as const;

export function RevisionDecision({ orderId, kind, locale = "ru" }: { orderId: number; kind: "accept" | "reject"; locale?: "ru" | "de" }) {
  const t = T[locale];
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run(action: "accept" | "reject") {
    setMsg(null);
    startTransition(async () => {
      const r = action === "accept" ? await acceptRevisionAction(orderId) : await rejectRevisionAction(orderId);
      if (r.ok) {
        router.replace(`?msg=${action === "accept" ? "revision_accepted" : "revision_rejected"}`, { scroll: false });
      } else {
        setMsg(r.message ?? t.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-primary h-9" disabled={pending || kind !== "accept"} onClick={() => run("accept")}>
        {pending ? t.saving : t.accept}
      </button>
      <button type="button" className="btn btn-outline h-9" disabled={pending} onClick={() => run("reject")}>
        {t.reject}
      </button>
      {msg && <span className="text-sm text-danger">{msg}</span>}
    </div>
  );
}
