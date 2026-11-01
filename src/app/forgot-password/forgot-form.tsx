"use client";

import { useState, useTransition } from "react";
import { forgotPasswordAction } from "@/lib/auth-actions";

/**
 * Форма запроса сброса пароля. Одинаковый ответ для существующего и
 * несуществующего email (anti-enumeration): «если аккаунт есть — письмо уйдёт».
 */
export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div role="status" className="card p-6 text-center">
        <h2 className="text-lg font-semibold">Проверьте почту</h2>
        <p className="mt-2 text-sm text-muted">
          Если аккаунт с таким email существует, мы отправили письмо со ссылкой.
          Она действует 1 час.
        </p>
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
          Введите корректный email.
        </div>
      )}
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input-base" />
      </div>
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "Отправляем…" : "Отправить ссылку"}
      </button>
    </form>
  );
}
