"use client";

// POST-подтверждение токена (D3.6): GET не потребляет одноразовый токен.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyAction } from "@/lib/auth-actions";

export function VerifyButton({ token }: { token: string }) {
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (error) {
    return (
      <div role="alert" className="mt-4 rounded-base border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
        Токен не найден, истёк (24 ч) или уже использован.
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      className="btn btn-primary mt-6 w-full"
      onClick={() =>
        startTransition(async () => {
          const res = await verifyAction(token);
          if (!res.ok) {
            setError(true);
            return;
          }
          router.replace(`/verify?done=1&email=${encodeURIComponent(res.email!)}`);
        })
      }
    >
      {pending ? "Проверяем…" : "Подтвердить"}
    </button>
  );
}
