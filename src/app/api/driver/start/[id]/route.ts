// POST /api/driver/start/{id} — «Выехал» (assigned→enroute, Э5/D6.3), затем редирект на /driver.
// Локаль: Referer формы определяет DE (форма на /de/driver → редирект на /de/driver).

import { NextResponse } from "next/server";
import { startRouteAction } from "@/lib/actions";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orderId = Number(id);
  const r = Number.isFinite(orderId) ? await startRouteAction(orderId) : { ok: false, message: "bad id" };
  // DE-контекст: страница /de/driver шлёт форму с Referer /de/driver
  const referer = req.headers.get("referer") ?? "";
  const base = /:\/\/[^/]+\/de(\/|$)/.test(referer) ? "/de/driver" : "/driver";
  const url = r.ok ? new URL(base, req.url) : new URL(`${base}?msg=${encodeURIComponent(r.message ?? "state")}`, req.url);
  return NextResponse.redirect(url, 303);
}
