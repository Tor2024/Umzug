import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import type { Metadata } from "next";

// DE-версия /widerruf (этап 2 i18n).

export const metadata: Metadata = {
  title: "Widerruf",
  description: "Widerrufsrecht bei Fernabsatzverträgen: 14 Tage, §§ 355/356 BGB, Musterformulierung.",
};

const T = {
  h1: "Widerrufsrecht",
  sub: "Für Verbraucher bei Fernabsatzverträgen — §§ 355, 356 BGB.",
  s1: "1. Recht auf Widerruf",
  s1t:
    "Sie sind berechtigt, den Vertrag innerhalb von 14 Tagen ohne Angabe von Gründen zu widerrufen. Die Frist beginnt mit dem Abschluss des Vertrags (Bestätigung der Anfrage online).",
  s2: "2. So widerrufen Sie",
  s2t:
    "Mit einer Erklärung an die E-Mail aus dem Impressum unter Angabe der Auftragsnummer (z. B. „Ich widerrufe die Anfrage MS-2026-…“). Absendung vor Fristablauf genügt.",
  s3: "3. Folgen des Widerrufs",
  s3t:
    "Wir erstatten alles, was wir erhalten haben, innerhalb von 14 Tagen auf demselben Weg. Wenn Sie verlangt haben, dass die Leistung vor Ablauf der Widerrufsfrist beginnt (§ 356 Abs. 4 BGB), und die Leistung vollständig erbracht wurde, zahlen Sie den tatsächlich erbrachten Umfang; bei Zustimmung zum Beginn vor Fristablauf erlischt das Widerrufsrecht für diesen Umfang.",
  s4: "4. Sonderfall — naher Termin",
  s4t:
    "Bei Widerruf weniger als 72 Stunden vor dem vereinbarten Termin können wir die tatsächlich entstandenen Kosten einbehalten (reserviertes Team und Fahrzeug). Dies ist keine Strafe, sondern ein Ersatz — Art. 357 Abs. 3 BGB.",
  s5: "5. Verzicht im Assistenten",
  s5t:
    "Im Kalkulator gibt es eine separate Option „Verzicht auf das Widerrufsrecht“ (§ 356 Abs. 4 BGB): sie ist standardmäßig NICHT markiert und nur nötig, wenn Sie möchten, dass wir am Anfragetag beginnen. Ohne Markierung behalten Sie das volle Widerrufsrecht.",
};

export default function WiderrufPageDe() {
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
        </div>
      </main>
      <SiteFooter locale="de" />
    </div>
  );
}
