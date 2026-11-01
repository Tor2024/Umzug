"use client";

// Кнопки решения по правке (D10): «Принять правку» / «Отклонить».
// Успех переживает refresh через URL-баннер (?msg=revision_accepted|revision_rejected) — UX @3180.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptRevisionAction, rejectRevisionAction } from "@/lib/actions";

export function RevisionDecision({ orderId, kind }: { orderId: number; kind: "accept" | "reject" }) {
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
        setMsg(r.message ?? "Ошибка.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-primary h-9" disabled={pending || kind !== "accept"} onClick={() => run("accept")}>
        {pending ? "Сохранение…" : "Принять правку"}
      </button>
      <button type="button" className="btn btn-outline h-9" disabled={pending} onClick={() => run("reject")}>
        Отклонить
      </button>
      {msg && <span className="text-sm text-danger">{msg}</span>}
    </div>
  );
}
