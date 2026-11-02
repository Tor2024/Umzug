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

export function LocaleSwitch({ current }: { current: "ru" | "de" }) {
  const pathname = usePathname() || "/";
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // setTimeout(0): setState не синхронно внутри effect (lint-правило no-sync-setState-in-effect)
    const t = setTimeout(() => setMounted(true), 0);
    document.cookie = `locale=${current}; path=/; max-age=31536000; samesite=lax`;
    return () => clearTimeout(t);
  }, [current]);

  // Зеркальный путь: /de/x → /x, /x → /de/x, / → /de (лендинг DE) и /de → /
  const mirror =
    current === "ru"
      ? pathname === "/"
        ? "/de"
        : `/de${pathname}`
      : pathname === "/de"
        ? "/"
        : pathname.replace(/^\/de/, "") || "/";

  const cls = (on: boolean) =>
    `rounded-base px-1.5 py-0.5 text-xs font-semibold tabular-nums ${on ? "bg-primary text-white" : "text-muted hover:text-ink"}`;

  return (
    <span
      className="flex shrink-0 items-center gap-0.5 rounded-base border border-line bg-surface px-1 py-0.5"
      aria-label="Sprache / Язык"
    >
      {/* mounted-гвард чтобы URL сервера/клиента не расходились (hydration) */}
      <Link href={mounted ? mirror : pathname} hrefLang="de" className={cls(current === "de")}>DE</Link>
      <Link href={mounted ? mirror : pathname} hrefLang="ru" className={cls(current === "ru")}>RU</Link>
    </span>
  );
}
