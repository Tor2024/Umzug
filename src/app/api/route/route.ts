// GET /api/route?from=&to= → {km, minutes, provider, error?} (D4.2).
// Ключ maps.api_key читается из config/env и НИКОГДА не возвращается в ответе (D4.3).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveRoute, validAddress } from "@/lib/geo";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = rateLimit(`route:${clientIp(req)}`, 20);
  if (!rl.ok) {
    return NextResponse.json(
      { km: 0, minutes: 0, provider: "fallback", error: "Слишком много запросов, попробуйте через минуту." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterS) } },
    );
  }
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!validAddress(from) || !validAddress(to)) {
    return NextResponse.json(
      { km: 0, minutes: 0, provider: "fallback", error: "Укажите оба адреса (3–200 символов)." },
      { status: 200 },
    );
  }
  const db = await getDb();
  const apiKeyRes = await db.execute("SELECT value FROM config WHERE key = 'maps.api_key'");
  const apiKeyRow = apiKeyRes.rows[0] as unknown as { value: string } | undefined;
  const apiKey = apiKeyRow?.value || process.env.GOOGLE_MAPS_API_KEY || undefined;
  const result = await resolveRoute(from, to, apiKey);
  return NextResponse.json(result, { status: 200 });
}
