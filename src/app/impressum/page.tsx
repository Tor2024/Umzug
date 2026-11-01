import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { SITE } from "@/lib/site";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Impressum",
  description: "Импрессум (§ 5 DDG) — обязательные сведения о компании.",
  robots: { index: true, follow: true },
};

/** Impressum по § 5 DDG (немецкое требование). Демо-реквизиты — заменить перед запуском. */
export default function ImpressumPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-3xl font-bold">Impressum</h1>
        <p className="mt-1 text-sm text-muted">Сведения согласно § 5 DDG (Digitale-Dienste-Gesetz).</p>

        <div className="card mt-6 space-y-4 p-6 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold">Поставщик услуг</h2>
            <p className="mt-1">{SITE.name}<br />{SITE.address}<br />Германия</p>
          </section>
          <section>
            <h2 className="font-semibold">Контакты</h2>
            <p className="mt-1">
              Телефон: <a className="text-accent hover:underline" href={SITE.phoneHref}>{SITE.phone}</a><br />
              Email: <a className="text-accent hover:underline" href={`mailto:${SITE.email}`}>{SITE.email}</a>
            </p>
          </section>
          <section>
            <h2 className="font-semibold">Регистрация</h2>
            <p className="mt-1">Коммерческий реестр: {SITE.hrb}<br />Управляющий: демо-данные (заменить)<br />USt-IdNr.: {SITE.vatId}</p>
          </section>
          <section>
            <h2 className="font-semibold">Ответственность за перевозку</h2>
            <p className="mt-1">{SITE.liability}</p>
          </section>
          <section>
            <h2 className="font-semibold">Споры</h2>
            <p className="mt-1">
              Мы не участвуем в процедурах разрешения споров перед потребительским арбитражем
              (Verbraucherschlichtungsstelle) и не обязаны этого делать (§ 36 VSBG).
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
