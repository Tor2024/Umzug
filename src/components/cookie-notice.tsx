"use client";

// Предупреждение о куках (TDDDG): только технически необходимые cookie
// (ms_session, ms_locale) — согласие не требуется (§ 25 (2) TDDDG),
// но пользователь видит понятное уведомление. Решение хранится в localStorage.
// Локаль: по pathname (/de/... → немецкий), co-located LABELS без словаря.

import { useEffect, useState } from "react";

const KEY = "cookie_notice_ack";

const LABELS = {
  ru: {
    aria: "Уведомление о cookies",
    text: <>Мы используем только <b>технически необходимые</b> cookies (сессия, язык). Реклама и отслеживание — отсутствуют. Подробнее: </>,
    more: "Datenschutz",
    ok: "Понятно",
    dp: "/datenschutz",
  },
  de: {
    aria: "Cookie-Hinweis",
    text: <>Wir verwenden nur <b>technisch notwendige</b> Cookies (Sitzung, Sprache). Keine Werbung, kein Tracking. Mehr dazu: </>,
    more: "Datenschutz",
    ok: "Verstanden",
    dp: "/de/datenschutz",
  },
} as const;

export function CookieNotice() {
  const [visible, setVisible] = useState(false);
  const [de, setDe] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // откладываем чтение localStorage из эффекта — lint no-sync-setState
    const t = setTimeout(() => {
      if (cancelled) return;
      setDe(window.location.pathname.startsWith("/de"));
      try {
        if (!localStorage.getItem(KEY)) setVisible(true);
      } catch {
        // localStorage недоступен (приватный режим) — показываем каждый раз
        setVisible(true);
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  // Локаль может смениться клиентской навигацией (/, → /de при первом визите) —
  // отслеживаем pathname, чтобы язык баннера всегда совпадал со страницей.
  useEffect(() => {
    const onNav = () => setDe(window.location.pathname.startsWith("/de"));
    onNav();
    window.addEventListener("popstate", onNav);
    // Next.js App Router навигация не триггерит popstate при push — интервал-гвард
    const iv = setInterval(onNav, 500);
    return () => { window.removeEventListener("popstate", onNav); clearInterval(iv); };
  }, []);

  if (!visible) return null;
  const L = LABELS[de ? "de" : "ru"];

  const ack = () => {
    try {
      localStorage.setItem(KEY, new Date().toISOString());
    } catch {
      // игнорируем — баннер просто исчезнет до перезагрузки
    }
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label={L.aria}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm">
          {L.text}
          <a className="text-accent hover:underline" href={L.dp}>{L.more}</a>.
        </p>
        <button className="btn btn-primary shrink-0 px-4 py-1.5 text-sm" type="button" onClick={ack}>
          {L.ok}
        </button>
      </div>
    </div>
  );
}
