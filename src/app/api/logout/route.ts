// POST /api/logout — выход (форма в /account). Server-action-free, чтобы форма работала из RSC.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export async function POST(_req: NextRequest): Promise<NextResponse> {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", _req.url), { status: 303 });
}
