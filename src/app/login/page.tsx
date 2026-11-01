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
  searchParams: Promise<{ error?: string; next?: string; email?: string }>;
}) {
  const { error, next, email } = await searchParams;
  const err = error ? ERRORS[error] ?? ERRORS["1"] : null;

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-base bg-primary text-white font-bold">
            П
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Вход</h1>
          <p className="mt-1 text-sm text-muted">Кабинет клиента и сотрудников</p>
        </div>

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
          <button type="submit" className="btn btn-primary w-full">Войти</button>
        </form>

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
