import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import type { Metadata } from "next";

// DE-версия /agb (этап 2 i18n).

export const metadata: Metadata = {
  title: "Allgemeine Geschäftsbedingungen (AGB)",
  description: "Beförderungsbedingungen: Preis, Pflichten der Parteien, Haftung nach HGB, Beanstandungen.",
};

const T = {
  h1: "Allgemeine Geschäftsbedingungen (AGB)",
  sub: "Gelten für den Vertrag über die Beförderung von Haushaltsgut (Gütermobelpreise) nach HGB.",
  s1: "1. Preis und Tarif-Snapshot",
  s1t:
    "Der Preis wird aus den zum Zeitpunkt der Anfrage geltenden Tarifen berechnet und per Snapshot fixiert. Der vom Logistiker bestätigte Preis gilt 14 Tage und ändert sich nicht, auch wenn die Tarife steigen. Eine Abweichung des tatsächlichen Volumens bis 10 % in beide Richtungen ändert den Preis nicht; mehr — nach Tatsachen über Rechnung oder Beanstandung.",
  s2: "2. Pflichten des Kunden",
  s2t:
    "Genaue Adresse mit Zufahrt für Fahrzeuge 3,5–12 t; Aufzug/Etagen wahrheitsgemäß angegeben; am Objekt ist ein Parkplatz oder eine abgestimmte Halteverbotszone vorhanden. Sonntage und gesetzliche Feiertage sind keine Arbeitstage (§ 9 ArbZG); Verlegungen nach Absprache.",
  s3: "3. Zahlung",
  s3t:
    "Anzahlung 30 % vor dem Umzugstermin, Restbetrag nach der Abnahme per Rechnung mit Zahlungsziel (standardmäßig 14 Tage, § 271 BGB). Bei Verzug fallen Verzugszinsen nach § 288 BGB an; Mahnungen erfolgen in Stufen (14 / 30 Tage).",
  s4: "4. Haftung des Frachtführers",
  s4t:
    "Haftung für Beschädigung des Gutes nach § 451 i.V.m. § 431 HGB, maximal 620 € pro m³. Die Abnahme mit digitalem Protokoll (Unterschrift, Hash-Kette) dokumentiert den Zustand des Guts.",
  s5: "5. Beanstandungen",
  s5t:
    "Offene Beschädigungen — spätestens 3 Tage nach der Abnahme, verdeckte — spätestens 14 Tage (§ 438 HGB). Registrierung der Beanstandung im Bereich „Beanstandungen“ Ihres Kundenbereichs oder per E-Mail an die Adresse aus dem Impressum.",
  s6: "6. Widerruf",
  s6t:
    "Online aufgegebene Anfrage — Fernabsatzvertrag: 14 Tage Widerrufsrecht (§§ 355, 357 BGB), Details auf der Seite „Widerruf“. Widerruf mit bestätigtem Termin innerhalb von 72 h — ggf. Erstattung der entstandenen Kosten.",
};

export default function AgbPageDe() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale="de" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-3xl font-bold">{T.h1}</h1>
        <p className="mt-1 text-sm text-muted">{T.sub}</p>

        <div className="card mt-6 space-y-5 p-6 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold">{T.s1}</h2>
            <p className="mt-1">{T.s1t}</p>
          </section>
          <section>
            <h2 className="font-semibold">{T.s2}</h2>
            <p className="mt-1">{T.s2t}</p>
          </section>
          <section>
            <h2 className="font-semibold">{T.s3}</h2>
            <p className="mt-1">{T.s3t}</p>
          </section>
          <section>
            <h2 className="font-semibold">{T.s4}</h2>
            <p className="mt-1">{T.s4t}</p>
          </section>
          <section>
            <h2 className="font-semibold">{T.s5}</h2>
            <p className="mt-1">{T.s5t}</p>
          </section>
          <section>
            <h2 className="font-semibold">{T.s6}</h2>
            <p className="mt-1">{T.s6t}</p>
          </section>
        </div>
      </main>
      <SiteFooter locale="de" />
    </div>
  );
}
