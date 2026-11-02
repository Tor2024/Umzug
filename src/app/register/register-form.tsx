"use client";

// Форма регистрации клиента (verify-ссылка уходит письмом; при сбое отправки — fallback-ссылка на экране)

import { useState, useTransition } from "react";
import { registerAction, type RegisterResult } from "@/lib/auth-actions";
import { isValidLatinName } from "@/lib/validate";

export function RegisterForm() {
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [nameHint, setNameHint] = useState(false);

  if (result?.ok && result.emailSent) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-bold mb-2">Проверьте почту</h2>
        <p className="text-sm text-muted mb-4">
          Мы отправили письмо со ссылкой подтверждения. Она действует 24 часа.
        </p>
        <p className="text-sm">
          <a href="/login" className="font-medium text-accent hover:underline">Перейти ко входу →</a>
        </p>
      </div>
    );
  }

  if (result?.ok && result.verifyUrl) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-bold mb-2">Осталось подтвердить email</h2>
        <p className="text-sm text-muted mb-4">
          Письмо отправить не удалось, поэтому ссылка подтверждения показана здесь:
        </p>
        <a href={result.verifyUrl} className="block break-all rounded-base border border-trust/40 bg-trust/5 px-3 py-2 font-mono text-xs text-trust hover:underline">
          {result.verifyUrl}
        </a>
        <p className="mt-4 text-sm">
          <a href="/login" className="font-medium text-accent hover:underline">Перейти ко входу →</a>
        </p>
      </div>
    );
  }

  return (
    <form
      className="card p-6 flex flex-col gap-4"
      action={(fd) => startTransition(async () => setResult(await registerAction(fd)))}
    >
      {result && !result.ok && (
        <div role="alert" className="rounded-base border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {result.error === "exists"
            ? "Этот email уже зарегистрирован и подтверждён. Войдите."
            : result.error === "name"
              ? "Имя и фамилию укажите латиницей — два слова, как в загранпаспорте. Пример: Anna Safrova"
              : "Проверьте данные: имя, корректный email, пароль от 8 символов."}
        </div>
      )}
      <div>
        <label htmlFor="name" className="block text-sm font-medium mb-1">Имя и фамилия</label>
        <input
          id="name"
          name="name"
          required
          autoComplete="name"
          className="input-base"
          placeholder="Anna Safrova"
          onChange={(e) => {
            // Мягкая живая подсказка: подсвечиваем, пока имя не станет латиницей (2 слова)
            setNameHint(e.target.value.length > 0 && !isValidLatinName(e.target.value.trim()));
          }}
        />
        {nameHint ? (
          <p className="mt-1 text-xs text-danger">
            Латиницей, два слова — имя и фамилия, как в загранпаспорте. Пример: Anna Safrova
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">
            Латиницей, как в загранпаспорте — имя и фамилия. Это имя будет на счетах и документах.
          </p>
        )}
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input-base" />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">Пароль (мин. 8 символов)</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="input-base" />
      </div>
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "Создаём аккаунт…" : "Зарегистрироваться"}
      </button>
      <p className="text-center text-sm text-muted">
        Уже есть аккаунт? <a href="/login" className="font-medium text-accent hover:underline">Войти</a>
      </p>
    </form>
  );
}
