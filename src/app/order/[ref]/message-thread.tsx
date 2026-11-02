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

const ROLE_LABEL: Record<string, string> = {
  kunde: "Клиент",
  logist: "Логист",
  driver: "Водитель",
  finance: "Бухгалтер",
  admin: "Админ",
};

function timeLabel(unix: number): string {
  return new Date(unix * 1000).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function MessageThread({ orderRef, initial, viewerRole }: {
  orderRef: string;
  initial: MessageRow[];
  viewerRole: string;
}) {
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
        setError(res.message ?? "Не удалось отправить.");
        return;
      }
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), from_role: viewerRole, from_email: "вы", body, created_at: Math.floor(Date.now() / 1000) },
      ]);
      setText("");
    });
  }

  return (
    <div className="mb-6 rounded-container border border-line p-5">
      <h2 className="font-semibold">Сообщения по заявке</h2>
      <p className="mt-1 text-xs text-muted">
        Переписка клиента и персонала. Дублируется письмом-уведомлением (демо: письма идут на почту владельца).
      </p>
      {messages.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Сообщений пока нет.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {messages.map((m) => (
            <li key={m.id} className="rounded-lg border border-line bg-white/60 p-3 text-sm">
              <p className="text-xs text-muted">
                <b>{ROLE_LABEL[m.from_role] ?? m.from_role}</b> · {timeLabel(m.created_at)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-2">
        <textarea
          className="input min-h-20 w-full"
          placeholder="Ваше сообщение…"
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn btn-primary px-4 py-2 text-sm" onClick={submit} disabled={pending || text.trim().length < 2}>
          {pending ? "Отправляю…" : "Отправить"}
        </button>
      </div>
    </div>
  );
}
