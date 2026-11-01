"use server";

// Server actions аутентификации (Э2, D3). Все мутирующие действия перепроверяют данные на сервере.

import { redirect } from "next/navigation";
import { getDb, audit, hashPassword } from "./db";
import { login, setSessionCookie, clearSessionCookie, issueVerifyToken, consumeVerifyToken, issueResetToken, consumeResetToken, COOKIE } from "./auth";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Вход. Ошибки возвращаем на /login?error=..., успех → /login/success (там редирект по роли). */
export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  const res = await login(email, password);
  if (!res.ok) {
    const err = res.needsVerify ? "verify" : res.lockoutSec ? "lockout" : "1";
    redirect(`/login?error=${err}&next=${encodeURIComponent(next)}&email=${encodeURIComponent(email)}`);
  }
  await setSessionCookie(res.token!, res.expiresAt!);
  const db = await getDb();
  const uRes = await db.execute({
    sql: "SELECT id FROM users WHERE email = ?",
    args: [email.trim().toLowerCase()],
  });
  const u = uRes.rows[0] as unknown as { id: number } | undefined;
  await audit(db, u?.id ?? null, "login", "user", u?.id ?? "");
  redirect(next ? decodeURIComponent(next) : "/login/success");
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

export interface RegisterResult {
  ok: boolean;
  error?: "exists" | "invalid";
  verifyUrl?: string; // демо/fallback без SMTP: показываем ссылку на экране
  emailSent?: boolean; // письмо с verify-ссылкой отправлено через Resend
}

/** Регистрация клиента (kunde): email_verified=0; перерегистрация до подтверждения обновляет токен (D3.7). */
export async function registerAction(formData: FormData): Promise<RegisterResult> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name || !EMAIL_RE.test(email) || password.length < 8) {
    return { ok: false, error: "invalid" };
  }

  const db = await getDb();
  const existingRes = await db.execute({
    sql: "SELECT id, email_verified FROM users WHERE email = ?",
    args: [email],
  });
  const existing = existingRes.rows[0] as unknown as
    | { id: number; email_verified: number }
    | undefined;

  if (existing && existing.email_verified) {
    return { ok: false, error: "exists" };
  }

  let userId: number;
  if (existing) {
    // неподтверждённый повтор: обновляем имя/пароль/токен (D3.7)
    await db.execute({
      sql: "UPDATE users SET name = ?, password_hash = ? WHERE id = ?",
      args: [name, hashPassword(password), existing.id],
    });
    userId = existing.id;
  } else {
    const r = await db.execute({
      sql: "INSERT INTO users (email, name, role, password_hash, active, email_verified, created_at) VALUES (?, ?, 'kunde', ?, 1, 0, ?)",
      args: [email, name, hashPassword(password), Math.floor(Date.now() / 1000)],
    });
    userId = Number(r.lastInsertRowid);
  }

  const token = await issueVerifyToken(userId);
  await audit(db, userId, "register", "user", userId, existing ? "re-register unverified" : "self-registration");

  // Отправка verify-письма через Resend. Если ключа нет/не отправилось —
  // возвращаем verifyUrl как fallback (ссылка показывается на экране, как в демо).
  const { sendVerifyEmail } = await import("./email");
  const mail = await sendVerifyEmail(email, name, token);
  if (mail.sent) {
    return { ok: true, emailSent: true };
  }
  console.error("verify email not sent:", mail.reason);
  return { ok: true, verifyUrl: `/verify?token=${token}` };
}

/** Подтверждение email по токену. Одноразовый; после подтверждения — вход вручную (D3.6). */
export async function verifyAction(token: string): Promise<{ ok: boolean; email?: string }> {
  const email = await consumeVerifyToken(token);
  return email ? { ok: true, email } : { ok: false };
}

/** Запрос сброса пароля: письмо со ссылкой (всегда ok — не раскрываем, есть ли email в базе). */
export async function forgotPasswordAction(formData: FormData): Promise<{ ok: boolean; error?: "invalid" }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "invalid" };

  const db = await getDb();
  const uRes = await db.execute({
    sql: "SELECT id, name FROM users WHERE email = ? AND active = 1",
    args: [email],
  });
  const u = uRes.rows[0] as unknown as { id: number; name: string } | undefined;
  if (u) {
    const token = await issueResetToken(Number(u.id));
    await audit(db, Number(u.id), "password_reset_requested", "user", Number(u.id));
    const { sendResetEmail } = await import("./email");
    const mail = await sendResetEmail(email, String(u.name), token);
    if (!mail.sent) console.error("reset email not sent:", mail.reason);
  } else {
    await audit(db, null, "password_reset_unknown_email", "user", email);
  }
  // Одинаковый ответ для существующего и несуществующего email (anti-enumeration).
  return { ok: true };
}

/** Применение нового пароля по токену из письма. */
export async function resetPasswordAction(token: string, newPassword: string): Promise<{ ok: boolean }> {
  const ok = await consumeResetToken(token, newPassword);
  return { ok };
}

/** Смена пароля (заготовка Э7): инвалидирует сессии. */
export async function changePasswordAction(userId: number, oldPw: string, newPw: string): Promise<boolean> {
  const db = await getDb();
  const uRes = await db.execute({
    sql: "SELECT password_hash FROM users WHERE id = ?",
    args: [userId],
  });
  const u = uRes.rows[0] as unknown as { password_hash: string } | undefined;
  if (!u) return false;
  const { verifyPassword, invalidateUserSessions } = await import("./db");
  if (!verifyPassword(oldPw, u.password_hash) || newPw.length < 8) return false;
  await db.execute({
    sql: "UPDATE users SET password_hash = ? WHERE id = ?",
    args: [hashPassword(newPw), userId],
  });
  await invalidateUserSessions(db, userId);
  await audit(db, userId, "password_changed", "user", userId);
  return true;
}

// COOKIE импортирован для явной связи с auth.ts (используется setSessionCookie внутри auth)
void COOKIE;
