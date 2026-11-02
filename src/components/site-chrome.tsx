import Link from "next/link";
import { Logo } from "@/components/logo";
import { LocaleSwitch } from "@/components/locale-switch";

/** Шапка публичного сайта (Э8). Минимум: логотип,nav, CTA. locale: "ru" (по умолчанию, без префикса) | "de" (/de/...). */
export function SiteHeader({ locale = "ru" }: { locale?: "ru" | "de" }) {
  const T = {
    ru: { how: "Как работаем", services: "Услуги", login: "Войти", calc: "Рассчитать" },
    de: { how: "So funktioniert's", services: "Leistungen", login: "Anmelden", calc: "Berechnen" },
  }[locale];
  const p = (path: string): string => (locale === "de" ? `/de${path === "/" ? "" : path}` : path);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
        <Link href={p("/")} className="flex items-center gap-2 font-bold">
          <Logo size={32} />
          <span className="hidden sm:inline">Umzug Service</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <Link href={`${p("/")}#kak`} className="hidden overflow-wrap-anywhere px-2 py-2 hover:text-accent sm:inline">{T.how}</Link>
          <Link href={`${p("/")}#uslugi`} className="hidden overflow-wrap-anywhere px-2 py-2 hover:text-accent sm:inline">{T.services}</Link>
          <LocaleSwitch current={locale} />
          <Link href={p("/login")} className="min-w-16 px-2 py-2 text-center hover:text-accent">{T.login}</Link>
          <Link href={p("/calc")} className="btn btn-primary h-10 min-w-28 px-4 text-center">{T.calc}</Link>
        </nav>
      </div>
    </header>
  );
}

/** Подвал публичного сайта: реквизиты + юрссылки (Impressum-данные, § 5 DDG). */
export function SiteFooter({ locale = "ru" }: { locale?: "ru" | "de" }) {
  const T = {
    ru: {
      tagline: "Переезды по Германии: расчёт за минуту, фиксированная цена, экипаж и машина в одном заказе.",
      services: "Услуги", legal: "Правовая информация", contacts: "Контакты",
      items: [
        "Квартирный переезд", "Переезд офиса", "Мёбель-такси", "Догруз (shared load)",
      ],
      legalItems: [
        "Impressum (§ 5 DDG)", "Защита данных (DSGVO)", "Условия (AGB)", "Отмена (Widerruf)",
      ],
      legalPaths: ["/impressum", "/datenschutz", "/agb", "/widerruf"],
      demo: "Демо-среда: расчёты и документы носят ознакомительный характер",
    },
    de: {
      tagline: "Umzüge in Deutschland: Berechnung in einer Minute, Festpreis, Team und Wagen in einer Bestellung.",
      services: "Leistungen", legal: "Rechtliches", contacts: "Kontakt",
      items: [
        "Privatumzug", "Büroumzug", "Möbel-Taxi", "Beiladung (shared load)",
      ],
      legalItems: [
        "Impressum (§ 5 DDG)", "Datenschutz (DSGVO)", "AGB", "Widerruf",
      ],
      legalPaths: ["/de/impressum", "/de/datenschutz", "/de/agb", "/de/widerruf"],
      demo: "Demo-Umgebung: Berechnungen und Dokumente dienen nur der Orientierung",
    },
  }[locale];
  const p = (path: string): string => (locale === "de" ? `/de${path}` : path);
  return (
    <footer className="mt-auto border-t border-line bg-primary text-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="font-bold">Umzug Service</div>
          <p className="mt-2 text-sm text-slate-300">{T.tagline}</p>
        </div>
        <div className="text-sm">
          <div className="font-semibold">{T.services}</div>
          <ul className="mt-2 space-y-1 text-slate-300">
            {T.items.map((item) => (
              <li key={item}><Link href={`${p("/")}#uslugi`} className="hover:text-accent-soft">{item}</Link></li>
            ))}
          </ul>
        </div>
        <div className="text-sm">
          <div className="font-semibold">{T.legal}</div>
          <ul className="mt-2 space-y-1 text-slate-300">
            {T.legalItems.map((item, i) => (
              <li key={item}><Link href={T.legalPaths[i]} className="hover:text-accent-soft">{item}</Link></li>
            ))}
          </ul>
        </div>
        <div className="text-sm">
          <div className="font-semibold">{T.contacts}</div>
          <ul className="mt-2 space-y-1 text-slate-300">
            <li>Musterstraße 12, 10115 Berlin</li>
            <li><a href="tel:+49030000000000" className="hover:text-accent-soft">+49 (0)30 000 000 00</a></li>
            <li><a href="mailto:info@umzugservice.example" className="hover:text-accent-soft">info@umzugservice.example</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-slate-400">
        © 2026 Umzug Service GmbH · {T.demo}
      </div>
    </footer>
  );
}
