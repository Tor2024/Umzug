"use client";

// Предупреждение о куках (TDDDG): только технически необходимые cookie
// (ms_session, ms_locale) — согласие не требуется (§ 25 (2) TDDDG),
// но пользователь видит понятное уведомление. Решение хранится в localStorage.

import { useEffect, useState } from "react";

const KEY = "cookie_notice_ack";

export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // откладываем чтение localStorage из эффекта — lint no-sync-setState
    const t = setTimeout(() => {
      if (cancelled) return;
      try {
        if (!localStorage.getItem(KEY)) setVisible(true);
      } catch {
        // localStorage недоступен (приватный режим) — показываем каждый раз
        setVisible(true);
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  if (!visible) return null;

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
      aria-label="Уведомление о cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm">
          Мы используем только <b>технически необходимые</b> cookies (сессия, язык).
          Реклама и отслеживание — отсутствуют. Подробнее:{" "}
          <a className="text-accent hover:underline" href="/datenschutz">Datenschutz</a>.
        </p>
        <button className="btn btn-primary shrink-0 px-4 py-1.5 text-sm" type="button" onClick={ack}>
          Понятно
        </button>
      </div>
    </div>
  );
}
