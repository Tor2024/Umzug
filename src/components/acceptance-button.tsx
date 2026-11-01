"use client";

// Кнопка «Подтвердить приёмку» (D6.7): успех виден через URL-баннер (?msg=accepted),
// который переживает refresh (UX-feedback @3180); ошибки — локально.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptOrderAction } from "@/lib/actions";

export function AcceptanceButton({ orderId }: { orderId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await acceptOrderAction(orderId);
      if (r.ok) {
        router.replace(`?msg=accepted`, { scroll: false });
      } else {
        setError(r.message ?? "Не удалось подтвердить приёмку.");
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="btn btn-primary"
        aria-live="polite"
      >
        {pending ? "Подтверждение…" : "Подтвердить приёмку"}
      </button>
      {error && <p className="mt-2 rounded-base bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
