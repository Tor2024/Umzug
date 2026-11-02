import Link from "next/link";

/** Шапка публичного сайта (Э8). Минимум: логотип,nav, CTA. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-bold">
          {/* Логотип: фургон в оранжевом круге (совпадает с favicon) */}
          <svg className="size-8 shrink-0" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="32" fill="#EA7A28"/>
            <g transform="translate(13.5,17.5)" stroke="#ffffff" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M 3 20 L 3 12 Q 3 4 12 4 L 27 4 Q 32 4 35 9 L 38 14 Q 39 16 39 20 L 37 20"/>
              <path d="M 3 20 L 5 20"/>
              <circle cx="11" cy="22" r="3.4"/>
              <circle cx="29" cy="22" r="3.4"/>
              <path d="M 15 22 L 25 22"/>
            </g>
          </svg>
          <span className="hidden sm:inline">Umzug Service</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-4">
          <Link href="/#kak" className="hidden px-2 py-2 hover:text-accent sm:inline">Как работаем</Link>
          <Link href="/#uslugi" className="hidden px-2 py-2 hover:text-accent sm:inline">Услуги</Link>
          <Link href="/login" className="px-2 py-2 hover:text-accent">Войти</Link>
          <Link href="/calc" className="btn btn-primary h-10 px-4">Рассчитать</Link>
        </nav>
      </div>
    </header>
  );
}

/** Подвал публичного сайта: реквизиты + юрссылки (Impressum-данные, § 5 DDG). */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-primary text-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="font-bold">Umzug Service</div>
          <p className="mt-2 text-sm text-slate-300">Переезды по Германии: расчёт за минуту, фиксированная цена, экипаж и машина в одном заказе.</p>
        </div>
        <div className="text-sm">
          <div className="font-semibold">Услуги</div>
          <ul className="mt-2 space-y-1 text-slate-300">
            <li><Link href="/#uslugi" className="hover:text-accent-soft">Квартирный переезд</Link></li>
            <li><Link href="/#uslugi" className="hover:text-accent-soft">Переезд офиса</Link></li>
            <li><Link href="/#uslugi" className="hover:text-accent-soft">Мёбель-такси</Link></li>
            <li><Link href="/#uslugi" className="hover:text-accent-soft">Догруз (shared load)</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="font-semibold">Правовая информация</div>
          <ul className="mt-2 space-y-1 text-slate-300">
            <li><Link href="/impressum" className="hover:text-accent-soft">Impressum (§ 5 DDG)</Link></li>
            <li><Link href="/datenschutz" className="hover:text-accent-soft">Защита данных (DSGVO)</Link></li>
            <li><Link href="/agb" className="hover:text-accent-soft">Условия (AGB)</Link></li>
            <li><Link href="/widerruf" className="hover:text-accent-soft">Отмена (Widerruf)</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="font-semibold">Контакты</div>
          <ul className="mt-2 space-y-1 text-slate-300">
            <li>Musterstraße 12, 10115 Berlin</li>
            <li><a href="tel:+49030000000000" className="hover:text-accent-soft">+49 (0)30 000 000 00</a></li>
            <li><a href="mailto:info@umzugservice.example" className="hover:text-accent-soft">info@umzugservice.example</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-slate-400">
        © 2026 Umzug Service GmbH · Демо-среда: расчёты и документы носят ознакомительный характер
      </div>
    </footer>
  );
}
