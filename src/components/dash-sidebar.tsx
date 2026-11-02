"use client";

// Сайдбар панелей управления (требование @1641: «как бухгалтерские программы»):
// компактное левое меню по ролям, быстрый переход между разделами, logout внизу.
// На мобильном — верхняя полоса навигации (scrollable).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { logoutAction } from "@/lib/auth-actions";

export interface NavItem {
  href: string;
  label: string;
  /** Точная роль-строка — показывать только этим ролям (undefined = всем). */
  roles?: string[];
  /** Короткая иконка-буква/символ (без иконочных шрифтов — демо-стиль). */
  glyph: string;
}

/** Разделы по ролям (совпадает с ROLE_HOME и requireRole). */
const NAV: NavItem[] = [
  { href: "/account", label: "Мои заявки", glyph: "▤", roles: ["kunde"] },
  { href: "/calc", label: "Новый расчёт", glyph: "＋", roles: ["kunde"] },
  { href: "/dispatch", label: "Логистика", glyph: "▦", roles: ["logist", "admin"] },
  { href: "/inbox", label: "Инбокс", glyph: "✉", roles: ["logist", "admin"] },
  { href: "/driver", label: "Мой день", glyph: "▶", roles: ["driver", "admin"] },
  { href: "/finance", label: "Бухгалтерия", glyph: "€", roles: ["finance", "admin"] },
  { href: "/analytics", label: "Аналитика", glyph: "◑", roles: ["finance", "admin"] },
  { href: "/admin", label: "Админ-панель", glyph: "⚙", roles: ["admin"] },
];

export function DashSidebar({ userName, role }: { userName: string; role: string }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const items = NAV.filter((n) => !n.roles || n.roles.includes(role));

  const logout = (): void => {
    startTransition(async () => {
      await logoutAction();
      window.location.href = "/";
    });
  };

  return (
    <>
      {/* Десктоп: фиксированный сайдбар */}
      <aside className="dash-nav sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-primary text-white md:flex">
        <Link href="/" className="flex items-center gap-2 px-4 py-4 font-bold">
          <svg className="size-7 shrink-0" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="32" fill="#EA7A28"/>
            <g transform="translate(13.5,17.5)" stroke="#ffffff" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M 3 20 L 3 12 Q 3 4 12 4 L 27 4 Q 32 4 35 9 L 38 14 Q 39 16 39 20 L 37 20"/>
              <path d="M 3 20 L 5 20"/>
              <circle cx="11" cy="22" r="3.4"/>
              <circle cx="29" cy="22" r="3.4"/>
              <path d="M 15 22 L 25 22"/>
            </g>
          </svg>
          <span className="text-sm">Umzug Service</span>
        </Link>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2 text-sm" aria-label="Разделы панели">
          {items.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-base px-3 py-2 transition-colors ${
                  active ? "bg-white/15 font-semibold" : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span aria-hidden="true" className="w-4 text-center text-xs opacity-80">{n.glyph}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-4 py-3 text-xs">
          <p className="truncate font-semibold text-white">{userName}</p>
          <p className="mb-2 text-slate-400">{role}</p>
          <button type="button" onClick={logout} disabled={pending} className="text-slate-300 underline hover:text-white">
            {pending ? "Выхожу…" : "Выйти"}
          </button>
        </div>
      </aside>

      {/* Мобильный: горизонтальная полоса */}
      <nav className="dash-nav sticky top-0 z-30 flex items-center gap-1 overflow-x-auto border-b border-line bg-primary px-2 py-2 text-xs text-white md:hidden" aria-label="Разделы (мобильный)">
        <Link href="/" className="mr-1 shrink-0 font-bold">US</Link>
        {items.map((n) => {
          const active = pathname === n.href || pathname.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-base px-2.5 py-1.5 ${active ? "bg-white/15 font-semibold" : "text-slate-300"}`}
            >
              {n.label}
            </Link>
          );
        })}
        <button type="button" onClick={logout} disabled={pending} className="ml-auto shrink-0 rounded-base px-2 py-1.5 text-slate-300 underline">
          Выйти
        </button>
      </nav>
    </>
  );
}
