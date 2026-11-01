// GET /api/route?from=&to= → {km, minutes, provider, error?} (D4.2).
// Ключ maps.api_key читается из config/env и НИКОГДА не возвращается в ответе (D4.3).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveRoute, validAddress } from "@/lib/geo";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!validAddress(from) || !validAddress(to)) {
    return NextResponse.json(
      { km: 0, minutes: 0, provider: "fallback", error: "Укажите оба адреса (3–200 символов)." },
      { status: 200 },
    );
  }
  const db = getDb();
  const apiKeyRow = db.prepare("SELECT value FROM config WHERE key = 'maps.api_key'").get() as { value: string } | undefined;
  const apiKey = apiKeyRow?.value || process.env.GOOGLE_MAPS_API_KEY || undefined;
  const result = await resolveRoute(from, to, apiKey);
  return NextResponse.json(result, { status: 200 });
}
