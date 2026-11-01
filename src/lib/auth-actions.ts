"use server";

// Server actions аутентификации (Э2, D3). Все мутирующие действия перепроверяют данные на сервере.

import { redirect } from "next/navigation";
import { getDb, audit, hashPassword } from "./db";
import { login, setSessionCookie, clearSessionCookie, issueVerifyToken, consumeVerifyToken, COOKIE } from "./auth";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Вход. Ошибки возвращаем на /login?error=..., успех → /login/success (там редирект по роли). */
export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  const res = login(email, password);
  if (!res.ok) {
    const err = res.needsVerify ? "verify" : res.lockoutSec ? "lockout" : "1";
    redirect(`/login?error=${err}&next=${encodeURIComponent(next)}&email=${encodeURIComponent(email)}`);
  }
  await setSessionCookie(res.token!, res.expiresAt!);
  const db = getDb();
  const u = db.prepare("SELECT id FROM users WHERE email = ?").get(email.trim().toLowerCase()) as { id: number } | undefined;
  audit(db, u?.id ?? null, "login", "user", u?.id ?? "");
  redirect(next ? decodeURIComponent(next) : "/login/success");
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

export interface RegisterResult {
  ok: boolean;
  error?: "exists" | "invalid";
  verifyUrl?: string; // демо без SMTP: показываем ссылку на экране
}

/** Регистрация клиента (kunde): email_verified=0; перерегистрация до подтверждения обновляет токен (D3.7). */
export async function registerAction(formData: FormData): Promise<RegisterResult> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name || !EMAIL_RE.test(email) || password.length < 8) {
    return { ok: false, error: "invalid" };
  }

  const db = getDb();
  const existing = db.prepare("SELECT id, email_verified FROM users WHERE email = ?").get(email) as
    | { id: number; email_verified: number }
    | undefined;

  if (existing && existing.email_verified) {
    return { ok: false, error: "exists" };
  }

  let userId: number;
  if (existing) {
    // неподтверждённый повтор: обновляем имя/пароль/токен (D3.7)
    db.prepare("UPDATE users SET name = ?, password_hash = ? WHERE id = ?").run(name, hashPassword(password), existing.id);
    userId = existing.id;
  } else {
    const r = db.prepare(
      "INSERT INTO users (email, name, role, password_hash, active, email_verified, created_at) VALUES (?, ?, 'kunde', ?, 1, 0, ?)",
    ).run(email, name, hashPassword(password), Math.floor(Date.now() / 1000));
    userId = Number(r.lastInsertRowid);
  }

  const token = issueVerifyToken(userId);
  audit(db, userId, "register", "user", userId, existing ? "re-register unverified" : "self-registration");

  return { ok: true, verifyUrl: `/verify?token=${token}` };
}

/** Подтверждение email по токену. Одноразовый; после подтверждения — вход вручную (D3.6). */
export async function verifyAction(token: string): Promise<{ ok: boolean; email?: string }> {
  const email = consumeVerifyToken(token);
  return email ? { ok: true, email } : { ok: false };
}

/** Смена пароля (заготовка Э7): инвалидирует сессии. */
export async function changePasswordAction(userId: number, oldPw: string, newPw: string): Promise<boolean> {
  const db = getDb();
  const u = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string } | undefined;
  if (!u) return false;
  const { verifyPassword, invalidateUserSessions } = await import("./db");
  if (!verifyPassword(oldPw, u.password_hash) || newPw.length < 8) return false;
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(newPw), userId);
  invalidateUserSessions(db, userId);
  audit(db, userId, "password_changed", "user", userId);
  return true;
}

// COOKIE импортирован для явной связи с auth.ts (используется setSessionCookie внутри auth)
void COOKIE;
