// DE-Kalkulatorseite /de/calc (Э3). Gast kann rechnen; Absenden nur als kunde (D4.5).

import type { Metadata } from "next";
import { connection } from "next/server";
import { getSessionAsync } from "@/lib/auth";
import { getDb, getTariffs } from "@/lib/db";
import { CalcWizardDe } from "@/components/calc-wizard-de";

export const metadata: Metadata = { title: "Umzug berechnen" };
export const instant = false; // getSessionAsync → cookies + DB time (Date.now)

export default async function CalcDePage() {
  await connection(); // Route uses DB time (Date.now) — render at request time
  const user = await getSessionAsync();
  const tariffs = await getTariffs(await getDb());
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold sm:text-3xl">Umzug berechnen</h1>
      <p className="mb-6 text-muted">Strecke, Volumen, Leistungen — drei Schritte. Der Preis im Angebot wird offiziell und für 14 Tage festgehalten.</p>
      <CalcWizardDe loggedIn={user?.role === "kunde"} tariffs={tariffs} />
    </main>
  );
}
