"use client";

// DE-версия кнопки подтверждения email (этап 2 i18n). Логика идентична verify-button.tsx.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyAction } from "@/lib/auth-actions";

const T = {
  error: "Token nicht gefunden, abgelaufen (24 h) oder bereits verwendet.",
  checking: "Wird geprüft…",
  confirm: "Bestätigen",
};

export function VerifyButtonDe({ token }: { token: string }) {
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (error) {
    return (
      <div role="alert" className="mt-4 rounded-base border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
        {T.error}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      className="btn btn-primary mt-6 w-full min-w-16"
      onClick={() =>
        startTransition(async () => {
          const res = await verifyAction(token);
          if (!res.ok) {
            setError(true);
            return;
          }
          router.replace(`/de/verify?done=1&email=${encodeURIComponent(res.email!)}`);
        })
      }
    >
      {pending ? T.checking : T.confirm}
    </button>
  );
}
