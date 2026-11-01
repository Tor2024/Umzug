"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetPasswordAction } from "@/lib/auth-actions";

/** Форма нового пароля: одноразовый токен, при успехе — на вход. */
export function ResetForm({ token }: { token: string }) {
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
          setError("Пароль должен быть не короче 8 символов.");
          return;
        }
        if (pw !== pw2) {
          setError("Пароли не совпадают.");
          return;
        }
        setError(null);
        startTransition(async () => {
          const res = await resetPasswordAction(token, pw);
          if (!res.ok) {
            setError("Ссылка недействительна: истёк срок (1 час) или уже использована. Запросите новую.");
            return;
          }
          router.replace("/login?reset=1");
        });
      }}
    >
      {error && (
        <div role="alert" className="rounded-base border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">Новый пароль</label>
        <input id="password" name="password" type="password" required autoComplete="new-password" className="input-base" />
      </div>
      <div>
        <label htmlFor="password2" className="block text-sm font-medium mb-1">Повторите пароль</label>
        <input id="password2" name="password2" type="password" required autoComplete="new-password" className="input-base" />
      </div>
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "Сохраняем…" : "Сохранить пароль"}
      </button>
    </form>
  );
}
