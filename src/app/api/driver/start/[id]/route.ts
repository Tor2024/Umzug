// POST /api/driver/start/{id} — «Выехал» (assigned→enroute, Э5/D6.3), затем редирект на /driver.

import { NextResponse } from "next/server";
import { startRouteAction } from "@/lib/actions";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orderId = Number(id);
  const r = Number.isFinite(orderId) ? await startRouteAction(orderId) : { ok: false, message: "bad id" };
  const url = r.ok ? new URL("/driver", _req.url) : new URL(`/driver?msg=${encodeURIComponent(r.message ?? "state")}`, _req.url);
  return NextResponse.redirect(url, 303);
}
