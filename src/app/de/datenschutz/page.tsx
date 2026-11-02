import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import type { Metadata } from "next";

// DE-версия /datenschutz (этап 2 i18n).

export const metadata: Metadata = {
  title: "Datenschutz (DSGVO)",
  description: "Welche Daten bei der Nutzung des Dienstes verarbeitet werden und auf welcher Grundlage (DSGVO).",
};

const T = {
  h1: "Datenschutz",
  sub: "Rechtsgrundlagen — Art. 6 DSGVO. Verantwortliche Stelle ist das Unternehmen im Impressum.",
  whatTitle: "Welche Daten wir verarbeiten",
  what: [
    { k: "Konto:", v: "Name, E-Mail, Passwort (nur scrypt-Hash, nie das Passwort selbst) — Vertragserfüllung, Art. 6 (1) b." },
    { k: "Umzugsanfrage:", v: "Adressen, Datum, Volumen, Leistungen — Vertragserfüllung, Art. 6 (1) b." },
    { k: "Übergabeprotokoll:", v: "Tatsächliche Ladung, Unterschrift — Nachweis der Erfüllung, Art. 6 (1) f." },
    { k: "Rechnungen und Zahlungen:", v: "Beträge, Daten — buchhalterische Pflichten (GoBD), Art. 6 (1) c." },
    { k: "Audit-Log:", v: "Wer welche Aktion ausgeführt hat (ohne Inhalte) — Sicherheit, Art. 6 (1) f." },
  ],
  thirdTitle: "Drittanbieter",
  thirdText:
    "Die Routenberechnung nutzt offene Geodienste OpenStreetMap (Nominatim) und OSRM mit Deutschland-Filter. Bei der Übermittlung von Adressen ist für sie nur die Adresse ohne Bezug zu Ihrem Konto sichtbar. Bei Anbindung von Google Maps erfolgt die Verarbeitung nach Paul-Ehrlich-Str. 15 (Google Ireland) — die Übermittlung erfolgt gemäß den Google-DSGVO-Klauseln.",
  retentionTitle: "Speicherdauer",
  retention: [
    "Rechnungen und Buchhaltung: 10 Jahre (GoBD / § 147 AO).",
    "Protokolle und Verträge: 10 Jahre (Nachweis).",
    "Audit: 180 Tage.",
    "Sitzungen: Löschung beim Abmelden, maximal 12 h.",
  ],
  rightsTitle: "Ihre Rechte",
  rightsText:
    "Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20), Widerspruch (Art. 21), Beschwerde bei der Aufsichtsbehörde (Art. 77). Anfragen: E-Mail aus dem Impressum.",
  cookiesTitle: "Cookies",
  cookiesText:
    "Nur technisch notwendige: ms_session (Anmeldung) und ms_locale (Sprache). Ohne Einwilligung, da für den Betrieb der Website erforderlich (§ 25 (2) TDDDG).",
};

export default function DatenschutzPageDe() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale="de" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-3xl font-bold">{T.h1}</h1>
        <p className="mt-1 text-sm text-muted">{T.sub}</p>

        <div className="card mt-6 space-y-5 p-6 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold">{T.whatTitle}</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {T.what.map((i) => (
                <li key={i.k}><strong>{i.k}</strong> {i.v}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="font-semibold">{T.thirdTitle}</h2>
            <p className="mt-1">{T.thirdText}</p>
          </section>
          <section>
            <h2 className="font-semibold">{T.retentionTitle}</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {T.retention.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </section>
          <section>
            <h2 className="font-semibold">{T.rightsTitle}</h2>
            <p className="mt-1">{T.rightsText}</p>
          </section>
          <section>
            <h2 className="font-semibold">{T.cookiesTitle}</h2>
            <p className="mt-1">{T.cookiesText}</p>
          </section>
        </div>
      </main>
      <SiteFooter locale="de" />
    </div>
  );
}
