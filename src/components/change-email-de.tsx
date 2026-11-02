"use client";

// DE-копия change-email.tsx — тексты немецкие, экшен общий.

import { useState, useTransition } from "react";
import { changeEmailAction } from "@/lib/auth-actions";

export function ChangeEmailDe({ currentEmail }: { currentEmail: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // changeEmailAction возвращает русские message (общий экшен для RU/DE).
  // DE-клиент маппит по известным строкам — как routeErrorDe в calc-wizard-de.
  function deMsg(ok: boolean, m: string): string {
    if (ok) {
      if (m.includes("отправлено")) return "Der Bestätigungslink wurde an die neue Adresse gesendet.";
      if (m.includes("обновлён")) return "E-Mail aktualisiert.";
      return m;
    }
    const MAP: Array<[RegExp, string]> = [
      [/Войдите/, "Bitte melden Sie sich an."],
      [/Некорректный email/, "Ungültige E-Mail-Adresse."],
      [/недоступен/, "Diese E-Mail-Adresse ist nicht verfügbar."],
      [/не найден/, "Benutzer nicht gefunden."],
      [/Пароль неверный/, "Falsches Passwort."],
      [/уже ваш текущий/, "Das ist bereits Ihre aktuelle E-Mail-Adresse."],
      [/уже зарегистрирован/, "Diese E-Mail-Adresse ist bereits registriert."],
      [/Письмо не отправлено/, "E-Mail konnte nicht gesendet werden (Demo-Limit Resend) — bitte später erneut versuchen."],
      [/недействительна|истекла/, "Der Link ist ungültig oder abgelaufen."],
      [/уже занят/, "Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet."],
    ];
    for (const [re, de] of MAP) if (re.test(m)) return de;
    return m;
  }

  function submit() {
    setMsg(null);
    startTransition(async () => {
      const res = await changeEmailAction(email, password);
      setMsg({ ok: res.ok, text: deMsg(res.ok, res.message) });
      if (res.ok) {
        setEmail("");
        setPassword("");
      }
    });
  }

  return (
    <div className="mt-3 grid gap-2 border-t border-line pt-3">
      <p className="text-xs text-muted">
        E-Mail ändern: ein Bestätigungslink geht an die neue Adresse (1 Stunde gültig). Aktuell: {currentEmail}
      </p>
      <input
        className="input"
        type="email"
        placeholder="Neue E-Mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="input"
        type="password"
        placeholder="Aktuelles Passwort"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {msg && <p className={msg.ok ? "text-sm text-green-700" : "text-sm text-red-600"}>{msg.text}</p>}
      <button
        className="btn btn-outline px-3 py-1.5 text-sm"
        onClick={submit}
        disabled={pending || !email || !password}
      >
        {pending ? "Wird gesendet…" : "E-Mail ändern"}
      </button>
    </div>
  );
}
