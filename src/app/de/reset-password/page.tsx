import type { Metadata } from "next";
import Link from "next/link";
import { ResetFormDe } from "./reset-form-de";

// DE-версия /reset-password (этап 2 i18n).

export const metadata: Metadata = { title: "Neues Passwort", robots: { index: false } };
export const instant = false;

const T = {
  badge: "P",
  h1: "Neues Passwort",
  sub: "Bitte ein Passwort mit mindestens 8 Zeichen wählen",
  badLink: "Link unvollständig: Token fehlt.",
  newLink: "Neuen Link anfordern",
  home: "← Zur Startseite",
};

export default async function ResetPasswordPageDe({
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
            {T.badge}
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{T.h1}</h1>
          <p className="mt-1 text-sm text-muted">{T.sub}</p>
        </div>

        {token ? (
          <ResetFormDe token={token} />
        ) : (
          <div role="alert" className="card p-6 text-center text-sm">
            {T.badLink}
            <p className="mt-3">
              <Link href="/de/forgot-password" className="font-medium text-accent hover:underline">
                {T.newLink}
              </Link>
            </p>
          </div>
        )}

        <p className="mt-4 text-center text-sm">
          <Link href="/de" className="text-muted hover:text-ink">{T.home}</Link>
        </p>
      </div>
    </main>
  );
}
