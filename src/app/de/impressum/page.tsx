import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { SITE } from "@/lib/site";
import type { Metadata } from "next";

// DE-версия /impressum (этап 2 i18n).

export const metadata: Metadata = {
  title: "Impressum",
  description: "Impressum (§ 5 DDG) — gesetzlich vorgeschriebene Angaben zum Unternehmen.",
  robots: { index: true, follow: true },
};

const T = {
  sub: "Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz).",
  provider: "Diensteanbieter",
  country: "Deutschland",
  contacts: "Kontakte",
  phone: "Telefon:",
  register: "Registereintrag",
  registry: "Handelsregister:",
  ceo: "Geschäftsführer: Demo-Daten (zu ersetzen)",
  vat: "USt-IdNr.:",
  liability: "Haftung für den Transport",
  disputes: "Streitschlichtung",
  disputesText:
    "Wir sind nicht verpflichtet und nicht bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG).",
};

export default function ImpressumPageDe() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale="de" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-3xl font-bold">Impressum</h1>
        <p className="mt-1 text-sm text-muted">{T.sub}</p>

        <div className="card mt-6 space-y-4 p-6 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold">{T.provider}</h2>
            <p className="mt-1">{SITE.name}<br />{SITE.address}<br />{T.country}</p>
          </section>
          <section>
            <h2 className="font-semibold">{T.contacts}</h2>
            <p className="mt-1">
              {T.phone} <a className="text-accent hover:underline" href={SITE.phoneHref}>{SITE.phone}</a><br />
              E-Mail: <a className="text-accent hover:underline" href={`mailto:${SITE.email}`}>{SITE.email}</a>
            </p>
          </section>
          <section>
            <h2 className="font-semibold">{T.register}</h2>
            <p className="mt-1">{T.registry} {SITE.hrb}<br />{T.ceo}<br />{T.vat} {SITE.vatId}</p>
          </section>
          <section>
            <h2 className="font-semibold">{T.liability}</h2>
            <p className="mt-1">{SITE.liability}</p>
          </section>
          <section>
            <h2 className="font-semibold">{T.disputes}</h2>
            <p className="mt-1">{T.disputesText}</p>
          </section>
        </div>
      </main>
      <SiteFooter locale="de" />
    </div>
  );
}
