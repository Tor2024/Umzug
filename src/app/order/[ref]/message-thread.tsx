"use client";

import { useState, useTransition } from "react";
import { sendMessageAction } from "@/lib/actions";

export type MessageRow = {
  id: number;
  from_role: string;
  from_email: string;
  body: string;
  created_at: number;
};

const ROLE_LABEL = {
  ru: {
    kunde: "Клиент",
    logist: "Логист",
    driver: "Водитель",
    finance: "Бухгалтер",
    admin: "Админ",
  },
  de: {
    kunde: "Kunde",
    logist: "Disponent",
    driver: "Fahrer",
    finance: "Buchhaltung",
    admin: "Admin",
  },
} as const;

const T = {
  ru: {
    heading: "Сообщения по заявке",
    sub: "Переписка клиента и персонала. Дублируется письмом-уведомлением (демо: письма идут на почту владельца).",
    empty: "Сообщений пока нет.",
    placeholder: "Ваше сообщение…",
    sendFail: "Не удалось отправить.",
    you: "вы",
    sending: "Отправляю…",
    send: "Отправить",
  },
  de: {
    heading: "Nachrichten zur Anfrage",
    sub: "Verlauf zwischen Kunde und Personal. Wird zusätzlich per E-Mail benachrichtigt (Demo: E-Mails gehen an den Inhaber).",
    empty: "Noch keine Nachrichten.",
    placeholder: "Ihre Nachricht…",
    sendFail: "Senden fehlgeschlagen.",
    you: "Sie",
    sending: "Wird gesendet…",
    send: "Senden",
  },
} as const;

function timeLabel(unix: number): string {
  return new Date(unix * 1000).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function MessageThread({ orderRef, initial, viewerRole, locale = "ru" }: {
  orderRef: string;
  initial: MessageRow[];
  viewerRole: string;
  locale?: "ru" | "de";
}) {
  const t = T[locale];
  const roleLabel = ROLE_LABEL[locale as "ru" | "de"];
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const body = text.trim();
    if (body.length < 2) return;
    setError("");
    startTransition(async () => {
      const res = await sendMessageAction(orderRef, body);
      if (!res.ok) {
        setError(res.message ?? t.sendFail);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), from_role: viewerRole, from_email: t.you, body, created_at: Math.floor(Date.now() / 1000) },
      ]);
      setText("");
    });
  }

  return (
    <div className="mb-6 rounded-container border border-line p-5">
      <h2 className="font-semibold">{t.heading}</h2>
      <p className="mt-1 text-xs text-muted">
        {t.sub}
      </p>
      {messages.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t.empty}</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {messages.map((m) => (
            <li key={m.id} className="rounded-lg border border-line bg-white/60 p-3 text-sm">
              <p className="text-xs text-muted">
                <b>{roleLabel[m.from_role as keyof typeof roleLabel] ?? m.from_role}</b> · {timeLabel(m.created_at)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-2">
        <textarea
          className="input min-h-20 w-full"
          placeholder={t.placeholder}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn btn-primary px-4 py-2 text-sm" onClick={submit} disabled={pending || text.trim().length < 2}>
          {pending ? t.sending : t.send}
        </button>
      </div>
    </div>
  );
}
