import type { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/lib/auth-actions";

export const metadata: Metadata = { title: "Вход", robots: { index: false } };
export const instant = false;

const ERRORS: Record<string, string> = {
  "1": "Неверный email или пароль.",
  verify: "Email не подтверждён. Откройте ссылку из письма (в демо — ссылку после регистрации).",
  lockout: "Слишком много попыток. Попробуйте через 5 минут.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; email?: string; reset?: string }>;
}) {
  const { error, next, email, reset } = await searchParams;
  const err = error ? ERRORS[error] ?? ERRORS["1"] : null;

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <svg className="mx-auto size-12" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="32" fill="#EA7A28"/>
            <g transform="translate(13.5,17.5)" stroke="#ffffff" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M 3 20 L 3 12 Q 3 4 12 4 L 27 4 Q 32 4 35 9 L 38 14 Q 39 16 39 20 L 37 20"/>
              <path d="M 3 20 L 5 20"/>
              <circle cx="11" cy="22" r="3.4"/>
              <circle cx="29" cy="22" r="3.4"/>
              <path d="M 15 22 L 25 22"/>
            </g>
          </svg>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Вход</h1>
          <p className="mt-1 text-sm text-muted">Кабинет клиента и сотрудников</p>
        </div>

        {reset === "1" && (
          <div role="status" className="mb-4 rounded-base border border-trust/40 bg-emerald-50 px-4 py-3 text-sm text-ink">
            Пароль изменён. Войдите с новым паролем.
          </div>
        )}

        {err && (
          <div role="alert" className="mb-4 rounded-base border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            {err}
          </div>
        )}

        <form action={loginAction} className="card p-6 flex flex-col gap-4">
          <input type="hidden" name="next" value={next ?? ""} />
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email"
              defaultValue={email ?? ""} className="input-base" />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">Пароль</label>
            <input id="password" name="password" type="password" required autoComplete="current-password"
              className="input-base" />
          </div>
          <button type="submit" className="btn btn-trust w-full">Войти</button>
        </form>

        <p className="mt-3 text-center text-sm">
          <Link href="/forgot-password" className="text-muted hover:text-accent">Забыли пароль?</Link>
        </p>

        <p className="mt-4 text-center text-sm text-muted">
          Нет аккаунта?{" "}
          <Link href="/register" className="font-medium text-accent hover:underline">Зарегистрироваться</Link>
        </p>

        <div className="mt-8 rounded-base border border-line bg-surface px-4 py-3 text-xs text-muted">
          <p className="font-semibold text-ink mb-1">Демо-доступы (пароль: demo1234)</p>
          <p>klient@example.com — клиент · logist@example.com — логист</p>
          <p>voditel@example.com — водитель · buh@example.com — бухгалтер · admin@example.com — админ</p>
        </div>

        <p className="mt-4 text-center text-sm">
          <Link href="/" className="text-muted hover:text-ink">← На главную</Link>
        </p>
      </div>
    </main>
  );
}
