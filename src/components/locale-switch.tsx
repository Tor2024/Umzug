"use client";

/**
 * Переключатель DE | RU (немецкая версия сайта).
 * Co-located подход: без центрального словаря, только ссылка на зеркальную локаль.
 * RU-страницы живут без префикса, DE — под /de/...; ссылка ведёт на ту же страницу
 * в другой локали (путь сохраняется). Cookie locale ставится для future convenience
 * (серверу не нужен — ссылки абсолютные), но хранит последний выбор.
 */
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function LocaleSwitch({ current, compact = false }: { current: "ru" | "de"; compact?: boolean }) {
  const pathname = usePathname() || "/";
  useEffect(() => {
    // setTimeout(0): setState не синхронно внутри effect (lint-правило no-sync-setState-in-effect)
    const t = setTimeout(() => {
      document.cookie = `locale=${current}; path=/; max-age=31536000; samesite=lax`;
    }, 0);
    return () => clearTimeout(t);
  }, [current]);

  // Зеркальные пути: RU-ссылка ведёт на RU-путь (без /de), DE-ссылка — на DE-путь (с /de).
  const ruHref = current === "ru" ? pathname : pathname.replace(/^\/de/, "") || "/";
  const deHref = current === "de" ? pathname : pathname === "/" ? "/de" : pathname === "/de" ? "/de" : `/de${pathname}`;

  // ВАЖНО: cookie надо выставить ДО перехода. Серверный редирект / → /de читает
  // cookie в момент запроса: если на /de кликнули RU, а cookie ещё locale=de,
  // сервер отправит обратно на /de (переключение не сработает). Поэтому оба
  // линка синхронно ставят свою cookie в onClick — редирект видит актуальный выбор.
  // И ВАЖНО-2: это должны быть обычные <a>, не <Link> — Link делает soft-навигацию
  // из prefetch-кэша: серверный redirect() возвращается как RSC-редирект, компонент
  // /de NOT remount'ится, его useEffect перезаписывает cookie назад на de —
  // замкнутый круг (переключение выглядит «не работает»). Полный reload рвёт круг:
  // сервер видит свежую cookie и отдаёт нужную локаль.
  const setCookie = (v: "ru" | "de") => {
    document.cookie = `locale=${v}; path=/; max-age=31536000; samesite=lax`;
  };

  const cls = (on: boolean) =>
    `rounded-base font-semibold tabular-nums ${compact ? "border-white/30 px-1.5 py-0.5 text-xs" : "px-1.5 py-0.5 text-xs"} ${on ? "bg-accent text-white" : compact ? "text-slate-300 hover:text-white" : "text-muted hover:text-ink"}`;

  return (
    <span
      className={`flex shrink-0 items-center gap-0.5 rounded-base ${compact ? "border border-white/20 bg-white/5 px-1 py-0.5" : "border border-line bg-surface px-1 py-0.5"}`}
      aria-label="Sprache wechseln / Change language"
    >
      {/* <a> вместо Link: полный reload — сервер видит свежую cookie (см. ВАЖНО-2) */}
      <a href={deHref} hrefLang="de" className={cls(current === "de")} onClick={() => setCookie("de")}>DE</a>
      <a href={ruHref} hrefLang="ru" className={cls(current === "ru")} onClick={() => setCookie("ru")}>RU</a>
    </span>
  );
}
