"use client";

/**
 * Индикатор загрузки при переходах по ссылкам/кнопкам (задача пользователя:
 * «нажал — и видно, что загрузка идёт»). Оранжевая полоса сверху + чип
 * «Загружается… / Wird geladen…» в правом нижнем углу.
 * Локаль определяется по pathname (/de → немецкий текст), co-located T.
 */
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const T = {
  ru: "Загружается…",
  de: "Wird geladen…",
} as const;

export function RouteLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // переход завершён — скрыть индикатор (pathname/searchParams меняются при навигации);
    // setTimeout(0), чтобы пройти lint-правило no-sync-setState-in-effect (как cookie-notice)
    const t = setTimeout(() => setBusy(false), 0);
    return () => clearTimeout(t);
  }, [pathname, searchParams]);

  // Перехват кликов по ссылкам/кнопкам: показываем индикатор до завершения перехода.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest("a[href], button[form], button[type=submit]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href");
      if (href && (href.startsWith("/") || href.startsWith("#")) && href !== pathname) setBusy(true);
      // кнопки форм (server actions) обрабатываются SubmitButton — здесь не мешаем
      if (!href && a.tagName === "BUTTON" && a.getAttribute("form")) setBusy(true);
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
  }, [pathname]);

  if (!busy) return null;
  const lang = pathname?.startsWith("/de") ? "de" : "ru";

  return (
    <>
      {/* оранжевая полоса сверху */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-1 animate-pulse bg-accent" aria-hidden="true" />
      <div
        className="fixed bottom-20 right-4 z-[60] rounded-container bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-lg md:bottom-6"
        role="status"
      >
        {T[lang]}
      </div>
    </>
  );
}
