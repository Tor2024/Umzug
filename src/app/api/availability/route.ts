// D11: /api/availability?month=YYYY-MM&volume=&needsSecond= — только для авторизованных
// (гость не должен видеть загрузку парка — критик 1/п.3; кэш отключён — живые данные).

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getDb, findSession } from "@/lib/db";
import { monthAvailability, nearestFreeDate } from "@/lib/availability";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const jar = await cookies();
  const token = jar.get("ms_session")?.value ?? "";
  const user = token ? await findSession(getDb(), token) : null;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const month = req.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const volumeRaw = req.nextUrl.searchParams.get("volume");
  const needsSecond = req.nextUrl.searchParams.get("needsSecond") === "1";
  const volumeM3 = volumeRaw ? Number(volumeRaw.replace(",", ".")) : undefined;
  const opts = {
    volumeM3: volumeM3 !== undefined && Number.isFinite(volumeM3) ? volumeM3 : undefined,
    needsSecond,
  };

  const db = getDb();
  const data = await monthAvailability(db, month, opts);
  // Подсказка для express/переполненного месяца: ближайшая свободная дата
  const anyFree = Object.entries(data.dates).find(([, d]) => d.status === "free" || d.status === "partial");
  if (!anyFree) {
    const nearest = await nearestFreeDate(db, `${data.month}-01`, opts);
    return NextResponse.json({ ...data, nearestFree: nearest });
  }
  return NextResponse.json(data);
}
