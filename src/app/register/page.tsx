import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Регистрация", robots: { index: false } };
export const instant = false;

export default function RegisterPage() {
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-base bg-primary text-white font-bold">
            П
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Регистрация клиента</h1>
          <p className="mt-1 text-sm text-muted">Расчёт, отслеживание и документы по вашему переезду</p>
        </div>
        <RegisterForm />
        <p className="mt-4 text-center text-sm">
          <Link href="/" className="text-muted hover:text-ink">← На главную</Link>
        </p>
      </div>
    </main>
  );
}
