// «Помощник с переездом» — аутентификация и сессии (решение D3, PLAN §13).
// Клиент (kunde) сам регистрируется + подтверждает email; остальные роли создаёт админ.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, createSession, deleteSession, findSession, verifyPassword, audit, sha256, type SessionUser } from "./db";
import { randomBytes } from "node:crypto";

export type Role = SessionUser["role"];

export const COOKIE = "ms_session";

/** Блокировка подбора пароля (D3): 5 неудач по email → 5 минут. In-memory (демо, один процесс). */
const FAIL_LIMIT = 5;
const FAIL_WINDOW_S = 300;
const fails = new Map<string, { count: number; until: number }>();

function failKey(email: string): string {
  return email.trim().toLowerCase();
}

function lockoutRemaining(email: string): number {
  const rec = fails.get(failKey(email));
  if (!rec) return 0;
  const now = Math.floor(Date.now() / 1000);
  if (rec.count >= FAIL_LIMIT && now < rec.until) return rec.until - now;
  return 0;
}

function recordFail(email: string): void {
  const now = Math.floor(Date.now() / 1000);
  const rec = fails.get(failKey(email));
  if (!rec || now > rec.until) fails.set(failKey(email), { count: 1, until: now + FAIL_WINDOW_S });
  else rec.count += 1;
}

function clearFails(email: string): void {
  fails.delete(failKey(email));
}

// ---------------------------------------------------------------------------

export interface LoginResult {
  ok: boolean;
  token?: string;
  expiresAt?: number;
  needsVerify?: boolean;
  lockoutSec?: number;
}

/** Проверка учётных данных + создание сессии. Email нормализуется в нижний регистр. */
export async function login(email: string, password: string): Promise<LoginResult> {
  const em = email.trim().toLowerCase();
  const locked = lockoutRemaining(em);
  if (locked > 0) return { ok: false, lockoutSec: locked };

  const db = getDb();
  const res = await db.execute({
    sql: "SELECT id, password_hash, email_verified FROM users WHERE email = ?",
    args: [em],
  });
  const user = res.rows[0] as unknown as { id: number; password_hash: string; email_verified: number } | undefined;
  if (!user || !verifyPassword(password, String(user.password_hash))) {
    recordFail(em);
    return { ok: false };
  }
  if (!Number(user.email_verified)) {
    return { ok: false, needsVerify: true };
  }
  clearFails(em);
  const { token, expiresAt } = await createSession(db, Number(user.id));
  return { ok: true, token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: number): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // D3: на http://localhost без Secure
    path: "/",
    expires: new Date(expiresAt * 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  if (token) {
    deleteSession(getDb(), token);
    jar.delete(COOKIE);
  }
}

export async function getSessionAsync(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  if (!token) return null;
  return findSession(getDb(), token);
}

// ---------------------------------------------------------------------------

/** Домашняя страница роли после входа (§1). */
export const ROLE_HOME: Record<Role, string> = {
  kunde: "/account",
  logist: "/dispatch",
  driver: "/driver",
  finance: "/finance",
  admin: "/admin",
};

export async function requireUser(redirectTo: string): Promise<SessionUser> {
  const user = await getSessionAsync();
  if (!user) redirect(`/login?next=${encodeURIComponent(redirectTo)}`);
  return user;
}

export async function requireRole(roles: Role[], redirectTo: string): Promise<SessionUser> {
  const user = await requireUser(redirectTo);
  if (!roles.includes(user.role)) redirect(ROLE_HOME[user.role]);
  return user;
}

// ---------------------------------------------------------------------------

/** Одноразовый токен подтверждения email (D3): 24ч, DELETE при использовании. */
const VERIFY_TTL_S = 24 * 3600;

export async function issueVerifyToken(userId: number): Promise<string> {
  const db = getDb();
  const token = randomBytes(24).toString("hex");
  await db.execute({
    sql: "UPDATE users SET verify_token = ?, verify_expires = ? WHERE id = ?",
    args: [sha256(token), Math.floor(Date.now() / 1000) + VERIFY_TTL_S, userId],
  });
  return token;
}

/** Подтверждение: токен одноразовый (сравнение по хешу), истёкший/чужой → null. */
export async function consumeVerifyToken(token: string): Promise<string | null> {
  const db = getDb();
  const res = await db.execute({
    sql: "SELECT id, email FROM users WHERE verify_token = ? AND verify_expires > ? AND email_verified = 0",
    args: [sha256(token), Math.floor(Date.now() / 1000)],
  });
  const row = res.rows[0] as unknown as { id: number; email: string } | undefined;
  if (!row) return null;
  await db.execute({
    sql: "UPDATE users SET email_verified = 1, verify_token = NULL, verify_expires = NULL WHERE id = ?",
    args: [Number(row.id)],
  });
  await audit(db, Number(row.id), "email_verified", "user", Number(row.id));
  return String(row.email);
}
