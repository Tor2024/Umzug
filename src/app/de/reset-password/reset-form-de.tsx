"use client";

// DE-версия формы нового пароля (этап 2 i18n). Логика идентична reset-form.tsx.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetPasswordAction } from "@/lib/auth-actions";

const T = {
  errShort: "Das Passwort muss mindestens 8 Zeichen lang sein.",
  errMatch: "Passwörter stimmen nicht überein.",
  errInvalid: "Link ungültig: abgelaufen (1 Stunde) oder bereits verwendet. Bitte neuen Link anfordern.",
  newLabel: "Neues Passwort",
  repeatLabel: "Passwort wiederholen",
  saving: "Wird gespeichert…",
  submit: "Passwort speichern",
};

export function ResetFormDe({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="card p-6 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const pw = String(fd.get("password") ?? "");
        const pw2 = String(fd.get("password2") ?? "");
        if (pw.length < 8) {
          setError(T.errShort);
          return;
        }
        if (pw !== pw2) {
          setError(T.errMatch);
          return;
        }
        setError(null);
        startTransition(async () => {
          const res = await resetPasswordAction(token, pw);
          if (!res.ok) {
            setError(T.errInvalid);
            return;
          }
          router.replace("/de/login?reset=1");
        });
      }}
    >
      {error && (
        <div role="alert" className="rounded-base border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">{T.newLabel}</label>
        <input id="password" name="password" type="password" required autoComplete="new-password" className="input-base" />
      </div>
      <div>
        <label htmlFor="password2" className="block text-sm font-medium mb-1">{T.repeatLabel}</label>
        <input id="password2" name="password2" type="password" required autoComplete="new-password" className="input-base" />
      </div>
      <button type="submit" disabled={pending} className="btn btn-primary w-full min-w-16">
        {pending ? T.saving : T.submit}
      </button>
    </form>
  );
}
