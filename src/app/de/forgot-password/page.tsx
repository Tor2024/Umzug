import type { Metadata } from "next";
import Link from "next/link";
import { ForgotFormDe } from "./forgot-form-de";

// DE-версия /forgot-password (этап 2 i18n).

export const metadata: Metadata = { title: "Passwort wiederherstellen", robots: { index: false } };
export const instant = false;

const T = {
  badge: "P",
  h1: "Passwort wiederherstellen",
  sub: "E-Mail eingeben — wir senden einen Link zum Setzen eines neuen Passworts",
  remembered: "Passwort wieder eingefallen?",
  login: "Anmelden",
  home: "← Zur Startseite",
};

export default function ForgotPasswordPageDe() {
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-base bg-primary text-white font-bold">
            {T.badge}
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{T.h1}</h1>
          <p className="mt-1 text-sm text-muted">{T.sub}</p>
        </div>

        <ForgotFormDe />

        <p className="mt-4 text-center text-sm text-muted">
          {T.remembered}{" "}
          <Link href="/de/login" className="font-medium text-accent hover:underline">{T.login}</Link>
        </p>

        <p className="mt-4 text-center text-sm">
          <Link href="/de" className="text-muted hover:text-ink">{T.home}</Link>
        </p>
      </div>
    </main>
  );
}
