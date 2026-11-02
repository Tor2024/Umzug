import Link from "next/link";
import Image from "next/image";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { SITE } from "@/lib/site";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

// Первый визит (нет cookie locale) → /de (немецкая версия по умолчанию — решение
// пользователя). Повторные визиты: cookie locale запоминает выбор переключателя
// DE|RU (locale-switch.tsx), поэтому RU-посетители остаются на RU-лендинге.
export const instant = false;

export const metadata: Metadata = {
  title: "Umzug Service — расчёт переезда по Германии за минуту",
  description:
    "Честный расчёт стоимости переезда: маршрут по реальным дорогам, экипаж, машина, подъём/спуск, упаковка. Фиксированная цена до начала работ.",
};

/** Этапы работы (§7 интерактивность). Честные шаги без выдуманной статистики. */
const STEPS = [
  { n: 1, t: "Рассчитайте", d: "Адреса, объём, этажи, услуги — цена видна сразу, до отправки заявки." },
  { n: 2, t: "Отправьте заявку", d: "Логист проверяет цену и подтверждает её — она фиксируется на 14 дней." },
  { n: 3, t: "Назначим бригаду", d: "Подбираем машину по объёму и водителей на дату переезда." },
  { n: 4, t: "Переезд и приёмка", d: "В день переезда: погрузка, поездка, разгрузка, цифровой протокол и ваша подпись." },
];

/** Услуги. Формулировки честные: без выдуманных цифр и партнёров. */
const SERVICES = [
  { img: "/img/cargo-bay.jpg", t: "Квартирный переезд", d: "Машина по объёму вещей, экипаж грузчиков, подъём/спуск, сборка кухни — всё в одном расчёте." },
  { img: "/img/hub-corridor.jpg", t: "Офисный переезд", d: "Работаем выходные (суббота), чтобы понедельник ваш офис открылся на новом месте." },
  { img: "/img/box-sealed.jpg", t: "Мёбель-такси", d: "Отдельные предметы: диван, пианино, шкаф. Малый объём — малый счёт." },
  { img: "/img/hvz-street.jpg", t: "Halteverbotszone", d: "Организуем зону парковки у подъезда в день переезда — по запросу в заявке." },
];

export default async function HomePage() {
  const jar = await cookies();
  if (jar.get("locale")?.value !== "ru") redirect("/de");

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        {/* Hero: слева текст + CTA, справа фото. Калькулятор живёт на /calc (мобильный, пошаговый). */}
        <section className="border-b border-line bg-white">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 lg:grid-cols-2 lg:py-16">
            <div className="flex flex-col justify-center">
              <span className="chip chip-trust w-fit">Фиксированная цена · Смета действует 14 дней</span>
              <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
                Переезд по Германии — без сюрпризов
              </h1>
              <p className="mt-4 max-w-prose text-lg text-muted">
                Реальный маршрут, экипаж и машина по объёму вещей. Считаете сами за минуту,
                логист подтверждает цену — и она не меняется.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/calc" className="btn btn-primary px-6">Рассчитать переезд</Link>
                <Link href="#kak" className="btn btn-outline px-6">Как это работает</Link>
              </div>
            </div>
            <div className="relative min-h-64 overflow-hidden rounded-container border border-line lg:min-h-96">
              <Image src="/img/fleet-sprinter.jpg" alt="Машины компании на площадке" fill className="object-cover" priority />
            </div>
          </div>
        </section>

        {/* Trust-полоса: 4 честных факта (без выдуманных рейтингов). */}
        <section className="bg-page">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: "Фиксированная цена", d: "Смета закрепляется снимком тарифов — тарифы выросли, ваша цена нет." },
              { t: "Ответственность перевозчика", d: "Перевозка по немецкому праву (HGB) — договор с полной прозрачностью условий." },
              { t: "Прозрачный расчёт", d: "Каждая строка сметы видна: база, экипаж, дорога, подъём, услуги." },
              { t: "Цифровой протокол", d: "Приёмка с подписью и хеш-цепочкой — документы не подделать." },
            ].map((b) => (
              <div key={b.t} className="card p-5">
                <div className="font-semibold">{b.t}</div>
                <p className="mt-1 text-sm text-muted">{b.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Как работаем: 4 шага. */}
        <section id="kak" className="scroll-mt-16 bg-white py-12">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-bold">Как это работает</h2>
            <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className="card p-5">
                  <span className="flex size-8 items-center justify-center rounded-base bg-primary text-sm font-bold text-white">{s.n}</span>
                  <div className="mt-3 font-semibold">{s.t}</div>
                  <p className="mt-1 text-sm text-muted">{s.d}</p>
                </li>
              ))}
            </ol>
            <div className="mt-6">
              <Link href="/calc" className="btn btn-primary px-6">Начать расчёт</Link>
            </div>
          </div>
        </section>

        {/* Услуги: 4 карточки с фото. */}
        <section id="uslugi" className="scroll-mt-16 bg-page py-12">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-bold">Услуги</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {SERVICES.map((s) => (
                <div key={s.t} className="card-hover overflow-hidden">
                  <Image src={s.img} alt={s.t} width={800} height={450} className="aspect-video w-full object-cover" />
                  <div className="p-5">
                    <div className="font-semibold">{s.t}</div>
                    <p className="mt-1 text-sm text-muted">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Тёмный CTA. */}
        <section className="bg-primary py-12 text-white">
          <div className="mx-auto max-w-6xl px-4 text-center">
            <h2 className="text-2xl font-bold md:text-3xl">Посчитайте свой переезд прямо сейчас</h2>
            <p className="mx-auto mt-2 max-w-prose text-slate-300">
              Без регистрации: расчёт бесплатный. Заявка — уже с аккаунтом, чтобы вы видели статус.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/calc" className="btn bg-accent px-6 text-white hover:bg-accent-hover">Открыть калькулятор</Link>
              <a href={SITE.phoneHref} className="btn btn-outline border-white/30 px-6 text-white hover:border-white">Позвонить</a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      {/* JSON-LD MovingCompany (SEO-минимум Э8). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "MovingCompany",
            name: SITE.name,
            telephone: SITE.phone,
            email: SITE.email,
            address: { "@type": "PostalAddress", streetAddress: "Musterstraße 12", postalCode: "10115", addressLocality: "Berlin", addressCountry: "DE" },
            areaServed: "DE",
            url: "https://umzug-seven.vercel.app",
          }),
        }}
      />
    </div>
  );
}
