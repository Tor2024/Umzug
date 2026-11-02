"use client";

/**
 * Переключатель DE | RU (немецкая версия сайта).
 * Co-located подход: без центрального словаря, только ссылка на зеркальную локаль.
 * RU-страницы живут без префикса, DE — под /de/...; ссылка ведёт на ту же страницу
 * в другой локали (путь сохраняется). Cookie locale ставится для future convenience
 * (серверу не нужен — ссылки абсолютные), но хранит последний выбор.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function LocaleSwitch({ current, compact = false }: { current: "ru" | "de"; compact?: boolean }) {
  const pathname = usePathname() || "/";
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // setTimeout(0): setState не синхронно внутри effect (lint-правило no-sync-setState-in-effect)
    const t = setTimeout(() => setMounted(true), 0);
    document.cookie = `locale=${current}; path=/; max-age=31536000; samesite=lax`;
    return () => clearTimeout(t);
  }, [current]);

  // Зеркальные пути: RU-ссылка ведёт на RU-путь (без /de), DE-ссылка — на DE-путь (с /de).
  const ruHref = current === "ru" ? pathname : pathname.replace(/^\/de/, "") || "/";
  const deHref = current === "de" ? pathname : pathname === "/" ? "/de" : pathname === "/de" ? "/de" : `/de${pathname}`;

  const cls = (on: boolean) =>
    `rounded-base font-semibold tabular-nums ${compact ? "border-white/30 bg-white/10 px-1.5 py-0.5 text-xs" : "px-1.5 py-0.5 text-xs"} ${on ? "bg-accent text-white" : compact ? "text-slate-300 hover:text-white" : "text-muted hover:text-ink"}`;

  return (
    <span
      className={`flex shrink-0 items-center gap-0.5 rounded-base ${compact ? "border border-white/20 bg-white/5 px-1 py-0.5" : "border border-line bg-surface px-1 py-0.5"}`}
      aria-label="Sprache wechseln / Change language"
    >
      {/* mounted-гвард чтобы URL сервера/клиента не расходились (hydration) */}
      <Link href={mounted ? deHref : pathname} hrefLang="de" className={cls(current === "de")}>DE</Link>
      <Link href={mounted ? ruHref : pathname} hrefLang="ru" className={cls(current === "ru")}>RU</Link>
    </span>
  );
}
