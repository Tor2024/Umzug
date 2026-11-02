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
