// D11: /api/availability?month=YYYY-MM&volume=&needsSecond= — только для авторизованных
// (гость не должен видеть загрузку парка — критик 1/п.3; кэш отключён — живые данные).

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getDb, findSession, getTariffs } from "@/lib/db";
import { monthAvailability, nearestFreeDate, loadFactorPct } from "@/lib/availability";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const jar = await cookies();
  const token = jar.get("ms_session")?.value ?? "";
  const user = token ? await findSession(await getDb(), token) : null;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rl = rateLimit(`avail:${user.id ?? clientIp(req)}`, 60);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Слишком много запросов" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterS) } },
    );
  }

  const month = req.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const volumeRaw = req.nextUrl.searchParams.get("volume");
  const needsSecond = req.nextUrl.searchParams.get("needsSecond") === "1";
  const volumeM3 = volumeRaw ? Number(volumeRaw.replace(",", ".")) : undefined;
  const opts = {
    volumeM3: volumeM3 !== undefined && Number.isFinite(volumeM3) ? volumeM3 : undefined,
    needsSecond,
  };

  const db = await getDb();
  // Задача 6: per-date авто-коэффициент загрузки (0, если pricing.auto_load_pct=0 — выключено)
  const tariffs = await getTariffs(db);
  const data = await monthAvailability(db, month, opts);
  for (const dateIso of Object.keys(data.dates)) {
    data.dates[dateIso].autoLoadPct = loadFactorPct(data.dates[dateIso], tariffs.autoLoadPct);
  }
  // Подсказка для express/переполненного месяца: ближайшая свободная дата
  const anyFree = Object.entries(data.dates).find(([, d]) => d.status === "free" || d.status === "partial");
  if (!anyFree) {
    const nearest = await nearestFreeDate(db, `${data.month}-01`, opts);
    return NextResponse.json({ ...data, nearestFree: nearest });
  }
  return NextResponse.json(data);
}
