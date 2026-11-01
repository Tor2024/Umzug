import type { Metadata } from "next";
import Link from "next/link";
import { VerifyButton } from "./verify-button";

export const metadata: Metadata = { title: "Подтверждение email", robots: { index: false } };
export const instant = false;

/**
 * Подтверждение email (D3.6): GET-ссылка НЕ съедает токен — сначала страница
 * «Подтвердить?», подтверждение через POST (server action). Токен одноразовый.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string; email?: string }> }) {
  const { token, done, email } = await searchParams;

  if (done === "1") {
    return (
      <Shell>
        <h1 className="text-2xl font-bold tracking-tight">Email подтверждён</h1>
        <p className="mt-2 text-sm text-muted">{email}: аккаунт активен. Войдите с вашим паролем.</p>
        <Link href="/login" className="btn btn-primary mt-6 inline-flex">Войти</Link>
      </Shell>
    );
  }

  if (!token) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold tracking-tight">Ссылка неполная</h1>
        <p className="mt-2 text-sm text-muted">В ссылке нет токена подтверждения.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-bold tracking-tight">Подтвердить email?</h1>
      <p className="mt-2 text-sm text-muted">
        Нажмите «Подтвердить» — ссылка одноразовая и действует 24 часа.
      </p>
      <VerifyButton token={token} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-base bg-primary text-white font-bold">
          П
        </div>
        <div className="mt-4">{children}</div>
        <p className="mt-6 text-sm">
          <Link href="/" className="text-muted hover:text-ink">← На главную</Link>
        </p>
      </div>
    </main>
  );
}
