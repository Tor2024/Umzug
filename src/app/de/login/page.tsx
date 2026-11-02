import type { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/lib/auth-actions";

// DE-версия /login (этап 2 i18n): тот же JSX-скелет, co-located переводы.

export const metadata: Metadata = { title: "Anmelden", robots: { index: false } };
export const instant = false;

const ERRORS: Record<string, string> = {
  "1": "Falsche E-Mail oder falsches Passwort.",
  verify: "E-Mail nicht bestätigt. Öffnen Sie den Link aus der E-Mail (im Demo — Link nach der Registrierung).",
  lockout: "Zu viele Versuche. Bitte in 5 Minuten erneut versuchen.",
};

const T = {
  h1: "Anmelden",
  sub: "Kunden- und Mitarbeiterbereich",
  resetOk: "Passwort geändert. Melden Sie sich mit dem neuen Passwort an.",
  email: "E-Mail",
  password: "Passwort",
  submit: "Anmelden",
  forgot: "Passwort vergessen?",
  noAccount: "Noch kein Konto?",
  register: "Registrieren",
  demoTitle: "Demo-Zugänge (Passwort: demo1234)",
  demo1: "klient@example.com — Kunde · logist@example.com — Logistiker",
  demo2: "voditel@example.com — Fahrer · buh@example.com — Buchhaltung · admin@example.com — Admin",
  home: "← Zur Startseite",
};

export default async function LoginPageDe({
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
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{T.h1}</h1>
          <p className="mt-1 text-sm text-muted">{T.sub}</p>
        </div>

        {reset === "1" && (
          <div role="status" className="mb-4 rounded-base border border-trust/40 bg-emerald-50 px-4 py-3 text-sm text-ink">
            {T.resetOk}
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
            <label htmlFor="email" className="block text-sm font-medium mb-1">{T.email}</label>
            <input id="email" name="email" type="email" required autoComplete="email"
              defaultValue={email ?? ""} className="input-base" />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">{T.password}</label>
            <input id="password" name="password" type="password" required autoComplete="current-password"
              className="input-base" />
          </div>
          <button type="submit" className="btn btn-trust w-full min-w-16">{T.submit}</button>
        </form>

        <p className="mt-3 text-center text-sm">
          <Link href="/de/forgot-password" className="text-muted hover:text-accent">{T.forgot}</Link>
        </p>

        <p className="mt-4 text-center text-sm text-muted">
          {T.noAccount}{" "}
          <Link href="/de/register" className="font-medium text-accent hover:underline">{T.register}</Link>
        </p>

        <div className="mt-8 rounded-base border border-line bg-surface px-4 py-3 text-xs text-muted">
          <p className="font-semibold text-ink mb-1">{T.demoTitle}</p>
          <p>{T.demo1}</p>
          <p>{T.demo2}</p>
        </div>

        <p className="mt-4 text-center text-sm">
          <Link href="/de" className="text-muted hover:text-ink">{T.home}</Link>
        </p>
      </div>
    </main>
  );
}
