import type { Metadata } from "next";
import Link from "next/link";
import { VerifyButtonDe } from "./verify-button-de";

// DE-версия /verify (этап 2 i18n).

export const metadata: Metadata = { title: "E-Mail-Bestätigung", robots: { index: false } };
export const instant = false;

const T = {
  badge: "P",
  home: "← Zur Startseite",
  doneH1: "E-Mail bestätigt",
  doneP: (email?: string) => `${email ?? ""}: Konto ist aktiv. Melden Sie sich mit Ihrem Passwort an.`,
  login: "Anmelden",
  noTokenH1: "Link unvollständig",
  noTokenP: "In dem Link fehlt der Bestätigungstoken.",
  confirmH1: "E-Mail bestätigen?",
  confirmP: "Klicken Sie auf „Bestätigen“ — der Link ist einmalig und 24 Stunden gültig.",
};

export default async function VerifyPageDe({ searchParams }: { searchParams: Promise<{ token?: string; done?: string; email?: string }> }) {
  const { token, done, email } = await searchParams;

  if (done === "1") {
    return (
      <Shell home={T.home} badge={T.badge}>
        <h1 className="text-2xl font-bold tracking-tight">{T.doneH1}</h1>
        <p className="mt-2 text-sm text-muted">{T.doneP(email)}</p>
        <Link href="/de/login" className="btn btn-primary mt-6 inline-flex">{T.login}</Link>
      </Shell>
    );
  }

  if (!token) {
    return (
      <Shell home={T.home} badge={T.badge}>
        <h1 className="text-2xl font-bold tracking-tight">{T.noTokenH1}</h1>
        <p className="mt-2 text-sm text-muted">{T.noTokenP}</p>
      </Shell>
    );
  }

  return (
    <Shell home={T.home} badge={T.badge}>
      <h1 className="text-2xl font-bold tracking-tight">{T.confirmH1}</h1>
      <p className="mt-2 text-sm text-muted">{T.confirmP}</p>
      <VerifyButtonDe token={token} />
    </Shell>
  );
}

function Shell({ children, home, badge }: { children: React.ReactNode; home: string; badge: string }) {
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-base bg-primary text-white font-bold">
          {badge}
        </div>
        <div className="mt-4">{children}</div>
        <p className="mt-6 text-sm">
          <Link href="/de" className="text-muted hover:text-ink">{home}</Link>
        </p>
      </div>
    </main>
  );
}
