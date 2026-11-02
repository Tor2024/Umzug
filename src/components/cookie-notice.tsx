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
    title: "Cookies",
    text: "Только технически необходимые:",
    noAds: "Реклама и отслеживание — отсутствуют. Подробнее:",
    more: "Datenschutz",
    ok: "Понятно",
    dp: "/datenschutz",
  },
  de: {
    aria: "Cookie-Hinweis",
    title: "Cookies & Datenschutz",
    text: "Nur technisch notwendige:",
    noAds: "Keine Werbung, kein Tracking. Mehr dazu:",
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
      className="fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:right-4 sm:max-w-md"
    >
      <div className="rounded-2xl border border-line bg-white p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="text-2xl leading-none">🍪</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">{L.title}</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-1 text-sm text-muted">
              {L.text}
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink">Sitzung</span>
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink">Sprache</span>
            </p>
            <p className="mt-1.5 text-sm text-muted">
              {L.noAds} <a className="text-accent hover:underline" href={L.dp}>{L.more}</a>.
            </p>
          </div>
        </div>
        <button className="btn btn-primary mt-4 w-full min-w-16" type="button" onClick={ack}>
          {L.ok}
        </button>
      </div>
    </div>
  );
}
