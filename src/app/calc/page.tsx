// Страница калькулятора /calc (Э3). Гость может считать; сабмит — только kunde (D4.5).

import type { Metadata } from "next";
import { connection } from "next/server";
import { getSessionAsync } from "@/lib/auth";
import { getDb, getTariffs } from "@/lib/db";
import { CalcWizard } from "@/components/calc-wizard";

export const metadata: Metadata = { title: "Калькулятор переезда" };
export const instant = false; // getSessionAsync → cookies + DB time (Date.now)

export default async function CalcPage() {
  await connection(); // Route uses DB time (Date.now) — render at request time
  const user = await getSessionAsync();
  // Черновик клиента должен считаться по ТЕКУЩИМ серверным тарифам (иначе расхождение
  // с серверным расчётом при изменённых тарифах — найдено в Э9 E2E: per_km 80 vs 100).
  const tariffs = await getTariffs(getDb());
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold sm:text-3xl">Рассчитать переезд</h1>
      <p className="mb-6 text-muted">Маршрут, объём, услуги — три шага. Цена в заявке станет официальной и зафиксируется на 14 дней.</p>
      <CalcWizard loggedIn={user?.role === "kunde"} tariffs={tariffs} />
    </main>
  );
}
