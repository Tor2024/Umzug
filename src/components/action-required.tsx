import Link from "next/link";

export type ActionItem = {
  /** Уникальный ключ элемента */
  key: string;
  /** Что нужно сделать (глагол) */
  label: string;
  /** Ссылка на объект */
  href: string;
  /** Подпись объекта (ref, счёт и т.п.) */
  tag?: string;
  /** «Просрочено» / мягкое напоминание — для приоритизации */
  urgent?: boolean;
};

const T = {
  ru: { defaultTitle: "Требует вашего действия", open: "Открыть" },
  de: { defaultTitle: "Handlungsbedarf", open: "Öffnen" },
} as const;

/**
 * Ненавязчивый блок «Требует вашего действия» (задача фокуса на незаконченных
 * операциях). Рендерится наверху роли-панели; скрывается, когда дел нет.
 */
export function ActionRequired({ items, title, locale = "ru" }: {
  items: ActionItem[];
  title?: string;
  locale?: "ru" | "de";
}) {
  const t = T[locale];
  const resolvedTitle = title ?? t.defaultTitle;
  if (items.length === 0) return null;
  const urgent = items.filter((i) => i.urgent);
  const normal = items.filter((i) => !i.urgent);
  const sorted = [...urgent, ...normal];
  return (
    <div className="mb-8 rounded-container border border-accent-soft bg-orange-50 p-4">
      <h2 className="font-semibold">
        {resolvedTitle} <span className="ml-1 rounded-full bg-[#EA7A28] px-2 py-0.5 text-xs text-white">{items.length}</span>
      </h2>
      <ul className="mt-3 grid gap-2">
        {sorted.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white/70 px-3 py-2 text-sm">
            <span>
              {i.urgent && <span className="mr-1 text-red-600" aria-hidden>● </span>}
              {i.label}
              {i.tag && <span className="ml-2 font-semibold text-accent">{i.tag}</span>}
            </span>
            <Link className="btn btn-outline px-3 py-1 text-xs" href={i.href}>{t.open}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
