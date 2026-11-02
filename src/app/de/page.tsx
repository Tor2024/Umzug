import Link from "next/link";
import Image from "next/image";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { SITE } from "@/lib/site";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Umzug Service — Umzug in Deutschland in einer Minute berechnet",
  description:
    "Ehrliche Kostenberechnung: Route über echte Straßen, Team, Wagen, Tragen/Trappen, Verpackung. Festpreis vor Arbeitsbeginn.",
};

/** Этапы работы — DE (зеркало STEPS из /page.tsx). */
const STEPS = [
  { n: 1, t: "Berechnen", d: "Adressen, Volumen, Etagen, Leistungen — der Preis wird sofort sichtbar, vor der Anfrage." },
  { n: 2, t: "Anfrage senden", d: "Der Logistiker prüft und bestätigt den Preis — er ist 14 Tage garantiert." },
  { n: 3, t: "Team zugeteilt", d: "Wir wählen den Wagen nach Volumen und Fahrer für den Umzugstag." },
  { n: 4, t: "Umzug & Abnahme", d: "Am Umzugstag: Beladung, Fahrt, Entladung, digitales Protokoll und Ihre Unterschrift." },
];

/** Услуги — DE (зеркало SERVICES). Halteverbotszone остаётся немецким и в RU. */
const SERVICES = [
  { img: "/img/cargo-bay.jpg", t: "Privatumzug", d: "Wagen nach Volumen, Trage-Team, Tragen/Trappen, Küchenaufbau — alles in einer Berechnung." },
  { img: "/img/hub-corridor.jpg", t: "Büroumzug", d: "Wir arbeiten am Wochenende (Samstag), damit Ihr Büro montags am neuen Ort startet." },
  { img: "/img/box-sealed.jpg", t: "Möbel-Taxi", d: "Einzelstücke: Sofa, Klavier, Schrank. Kleines Volumen — kleine Rechnung." },
  { img: "/img/hvz-street.jpg", t: "Halteverbotszone", d: "Wir organisieren die Halteverbotszone am Umzugstag — auf Anfrage in der Bestellung." },
];

/** DE-лендинг: тот же JSX-скелет, что и RU (/page.tsx) — расхождение макета исключено. */
export default function DeHomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader locale="de" />
      <main className="flex-1">
        <section className="border-b border-line bg-white">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 lg:grid-cols-2 lg:py-16">
            <div className="flex flex-col justify-center">
              <span className="chip chip-trust w-fit">Festpreis · Angebot gilt 14 Tage</span>
              <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
                Umzug in Deutschland — ohne Überraschungen
              </h1>
              <p className="mt-4 max-w-prose text-lg text-muted">
                Echte Route, Team und Wagen nach Volumen. Berechnen Sie selbst in einer Minute,
                der Logistiker bestätigt den Preis — und er bleibt garantiert.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/de/calc" className="btn btn-primary px-6">Umzug berechnen</Link>
                <Link href="#kak" className="btn btn-outline px-6">So funktioniert&apos;s</Link>
              </div>
            </div>
            <div className="relative min-h-64 overflow-hidden rounded-container border border-line lg:min-h-96">
              <Image src="/img/fleet-sprinter.jpg" alt="Fahrzeuge des Unternehmens auf dem Hof" fill className="object-cover" priority />
            </div>
          </div>
        </section>

        <section className="bg-page">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: "Festpreis", d: "Das Angebot wird mit einem Tarif-Snapshot fixiert — Tarife steigen, Ihr Preis nicht." },
              { t: "Frachthaftung", d: "Transport nach deutschem Recht (HGB) — Vertrag mit voller Transparenz." },
              { t: "Transparente Rechnung", d: "Jede Position sichtbar: Grundpreis, Team, Fahrt, Tragen, Leistungen." },
              { t: "Digitales Protokoll", d: "Abnahme mit Unterschrift und Hash-Kette — Dokumente sind fälschungssicher." },
            ].map((b) => (
              <div key={b.t} className="card p-5">
                <div className="font-semibold">{b.t}</div>
                <p className="mt-1 text-sm text-muted">{b.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="kak" className="scroll-mt-16 bg-white py-12">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-bold">So funktioniert&apos;s</h2>
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
              <Link href="/de/calc" className="btn btn-primary px-6">Berechnung starten</Link>
            </div>
          </div>
        </section>

        <section id="uslugi" className="scroll-mt-16 bg-page py-12">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-bold">Leistungen</h2>
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

        <section className="bg-primary py-12 text-white">
          <div className="mx-auto max-w-6xl px-4 text-center">
            <h2 className="text-2xl font-bold md:text-3xl">Berechnen Sie Ihren Umzug jetzt</h2>
            <p className="mx-auto mt-2 max-w-prose text-slate-300">
              Ohne Registrierung: die Berechnung ist kostenlos. Die Anfrage — mit Konto, damit Sie den Status sehen.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/de/calc" className="btn bg-accent px-6 text-white hover:bg-accent-hover">Rechner öffnen</Link>
              <a href={SITE.phoneHref} className="btn btn-outline border-white/30 px-6 text-white hover:border-white">Anrufen</a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter locale="de" />
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
            url: "https://umzug-seven.vercel.app/de",
          }),
        }}
      />
    </div>
  );
}
