"use client";

// DE-версия формы сброса пароля (этап 2 i18n). Логика идентична forgot-form.tsx.

import { useState, useTransition } from "react";
import { forgotPasswordAction } from "@/lib/auth-actions";

const T = {
  checkMail: "Bitte prüfen Sie Ihre E-Mail",
  sentInfo: "Falls ein Konto mit dieser E-Mail existiert, haben wir eine E-Mail mit einem Link gesendet. Er ist 1 Stunde gültig.",
  errorEmail: "Bitte eine gültige E-Mail eingeben.",
  submitting: "Wird gesendet…",
  submit: "Link senden",
};

export function ForgotFormDe() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div role="status" className="card p-6 text-center">
        <h2 className="text-lg font-semibold">{T.checkMail}</h2>
        <p className="mt-2 text-sm text-muted">{T.sentInfo}</p>
      </div>
    );
  }

  return (
    <form
      className="card p-6 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const res = await forgotPasswordAction(fd);
          if (!res.ok) {
            setError(true);
            return;
          }
          setSent(true);
        });
      }}
    >
      {error && (
        <div role="alert" className="rounded-base border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {T.errorEmail}
        </div>
      )}
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">E-Mail</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input-base" />
      </div>
      <button type="submit" disabled={pending} className="btn btn-primary w-full min-w-16">
        {pending ? T.submitting : T.submit}
      </button>
    </form>
  );
}
