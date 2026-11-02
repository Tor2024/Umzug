"use client";

// DE-версия формы регистрации (этап 2 i18n): копия register-form.tsx с co-located переводами.
// Логика идентична (registerAction, валидации те же — имена латиницей, телефон +49/0).

import { useState, useTransition } from "react";
import { registerAction, type RegisterResult } from "@/lib/auth-actions";
import { isValidLatinName, isValidGermanPhone } from "@/lib/validate";

const T = {
  checkMail: "Bitte prüfen Sie Ihre E-Mail",
  mailSent: "Wir haben eine E-Mail mit dem Bestätigungslink gesendet. Er ist 24 Stunden gültig.",
  toLogin: "Zur Anmeldung →",
  verifyEmail: "E-Mail noch bestätigen",
  mailFailed: "Die E-Mail konnte nicht gesendet werden, daher wird der Bestätigungslink hier angezeigt:",
  errorExists: "Diese E-Mail ist bereits registriert und bestätigt. Bitte anmelden.",
  errorName: "Vor- und Nachname bitte in lateinischer Schrift — zwei Wörter, wie im Reisepass. Beispiel: Anna Safrova",
  errorPhone: "Bitte eine korrekte Telefonnummer angeben: +49… oder 0… (z. B. +49 151 23456789).",
  errorDefault: "Bitte prüfen Sie: Name, gültige E-Mail, Passwort ab 8 Zeichen.",
  nameLabel: "Vor- und Nachname",
  nameHintBad: "Lateinische Schrift, zwei Wörter — Vor- und Nachname, wie im Reisepass. Beispiel: Anna Safrova",
  nameHintOk: "Lateinische Schrift, wie im Reisepass — Vor- und Nachname. Dieser Name erscheint auf Rechnungen und Dokumenten.",
  phoneLabel: "Telefon (mobil)",
  phoneHintBad: "Nummer im deutschen Format: +49… oder 0…, z. B. +49 151 23456789.",
  phoneHintOk: "Darüber stimmt der Logistiker die Umzugsdetails ab.",
  passwordLabel: "Passwort (min. 8 Zeichen)",
  submitting: "Konto wird erstellt…",
  submit: "Registrieren",
  haveAccount: "Schon ein Konto?",
  login: "Anmelden",
};

export function RegisterFormDe() {
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [nameHint, setNameHint] = useState(false);
  const [phoneHint, setPhoneHint] = useState(false);

  if (result?.ok && result.emailSent) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-bold mb-2">{T.checkMail}</h2>
        <p className="text-sm text-muted mb-4">{T.mailSent}</p>
        <p className="text-sm">
          <a href="/de/login" className="font-medium text-accent hover:underline">{T.toLogin}</a>
        </p>
      </div>
    );
  }

  if (result?.ok && result.verifyUrl) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-bold mb-2">{T.verifyEmail}</h2>
        <p className="text-sm text-muted mb-4">{T.mailFailed}</p>
        <a href={result.verifyUrl} className="block break-all rounded-base border border-trust/40 bg-trust/5 px-3 py-2 font-mono text-xs text-trust hover:underline">
          {result.verifyUrl}
        </a>
        <p className="mt-4 text-sm">
          <a href="/de/login" className="font-medium text-accent hover:underline">{T.toLogin}</a>
        </p>
      </div>
    );
  }

  return (
    <form
      className="card p-6 flex flex-col gap-4"
      action={(fd) => startTransition(async () => setResult(await registerAction(fd)))}
    >
      {result && !result.ok && (
        <div role="alert" className="rounded-base border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {result.error === "exists"
            ? T.errorExists
            : result.error === "name"
              ? T.errorName
              : result.error === "phone"
                ? T.errorPhone
                : T.errorDefault}
        </div>
      )}
      <div>
        <label htmlFor="name" className="block text-sm font-medium mb-1">{T.nameLabel}</label>
        <input
          id="name"
          name="name"
          required
          autoComplete="name"
          className="input-base"
          placeholder="Anna Safrova"
          onChange={(e) => {
            setNameHint(e.target.value.length > 0 && !isValidLatinName(e.target.value.trim()));
          }}
        />
        {nameHint ? (
          <p className="mt-1 text-xs text-danger">{T.nameHintBad}</p>
        ) : (
          <p className="mt-1 text-xs text-muted">{T.nameHintOk}</p>
        )}
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">E-Mail</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input-base" />
      </div>
      <div>
        <label htmlFor="phone" className="block text-sm font-medium mb-1">{T.phoneLabel}</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          required
          autoComplete="tel"
          className="input-base"
          placeholder="+49 151 23456789"
          onChange={(e) => {
            setPhoneHint(e.target.value.length > 0 && !isValidGermanPhone(e.target.value.trim()));
          }}
        />
        {phoneHint ? (
          <p className="mt-1 text-xs text-danger">{T.phoneHintBad}</p>
        ) : (
          <p className="mt-1 text-xs text-muted">{T.phoneHintOk}</p>
        )}
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">{T.passwordLabel}</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="input-base" />
      </div>
      <button type="submit" disabled={pending} className="btn btn-primary w-full min-w-16">
        {pending ? T.submitting : T.submit}
      </button>
      <p className="text-center text-sm text-muted">
        {T.haveAccount} <a href="/de/login" className="font-medium text-accent hover:underline">{T.login}</a>
      </p>
    </form>
  );
}
