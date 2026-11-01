import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Новый пароль", robots: { index: false } };
export const instant = false;

/** Страница задания нового пароля по одноразовой ссылке из письма (1ч TTL). */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-base bg-primary text-white font-bold">
            П
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Новый пароль</h1>
          <p className="mt-1 text-sm text-muted">Придумайте пароль длиной не менее 8 символов</p>
        </div>

        {token ? (
          <ResetForm token={token} />
        ) : (
          <div role="alert" className="card p-6 text-center text-sm">
            Ссылка неполная: в ней нет токена.
            <p className="mt-3">
              <Link href="/forgot-password" className="font-medium text-accent hover:underline">
                Запросить новую ссылку
              </Link>
            </p>
          </div>
        )}

        <p className="mt-4 text-center text-sm">
          <Link href="/" className="text-muted hover:text-ink">← На главную</Link>
        </p>
      </div>
    </main>
  );
}
