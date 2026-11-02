"use server";

// Server actions аутентификации (Э2, D3). Все мутирующие действия перепроверяют данные на сервере.

import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { getDb, audit, hashPassword, sha256 } from "./db";
import { isValidLatinName, isValidGermanPhone } from "./validate";
import { login, setSessionCookie, clearSessionCookie, issueVerifyToken, consumeVerifyToken, issueResetToken, consumeResetToken, COOKIE } from "./auth";

async function currentUser() {
  const db = await getDb();
  const jar = await cookies();
  return import("./db").then((m) => m.findSession(db, jar.get(COOKIE)?.value ?? ""));
}
import { cookies } from "next/headers";

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
  error?: "exists" | "invalid" | "name" | "phone";
  verifyUrl?: string; // демо/fallback без SMTP: показываем ссылку на экране
  emailSent?: boolean; // письмо с verify-ссылкой отправлено через Resend
}

/** Регистрация клиента (kunde): email_verified=0; перерегистрация до подтверждения обновляет токен (D3.7). */
export async function registerAction(formData: FormData): Promise<RegisterResult> {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const phone = String(formData.get("phone") ?? "").trim().replace(/\s+/g, " ");

  if (!name || !EMAIL_RE.test(email) || password.length < 8) {
    return { ok: false, error: "invalid" };
  }
  if (!isValidLatinName(name)) {
    return { ok: false, error: "name" };
  }
  if (!isValidGermanPhone(phone)) {
    return { ok: false, error: "phone" };
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
    // неподтверждённый повтор: обновляем имя/пароль/телефон/токен (D3.7)
    await db.execute({
      sql: "UPDATE users SET name = ?, password_hash = ?, phone = ? WHERE id = ?",
      args: [name, hashPassword(password), phone, existing.id],
    });
    userId = existing.id;
  } else {
    const r = await db.execute({
      sql: "INSERT INTO users (email, name, role, password_hash, active, email_verified, phone, created_at) VALUES (?, ?, 'kunde', ?, 1, 0, ?, ?)",
      args: [email, name, hashPassword(password), phone, Math.floor(Date.now() / 1000)],
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

/**
 * Аудит #8: смена email клиентом. Новый email сохраняется в pending_email,
 * ссылка-подтверждение уходит на новый адрес; смену подтверждает consumeEmailChangeToken.
 */
export async function changeEmailAction(newEmailRaw: string, password: string): Promise<{ ok: boolean; message: string }> {
  const db = await getDb();
  const user = await currentUser();
  if (!user) return { ok: false, message: "Войдите в аккаунт." };
  const newEmail = newEmailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return { ok: false, message: "Некорректный email." };
  if (newEmail.endsWith("@deleted.local")) return { ok: false, message: "Такой email недоступен." };

  const uRes = await db.execute({ sql: "SELECT password_hash, email FROM users WHERE id = ?", args: [user.id] });
  const u = uRes.rows[0] as unknown as { password_hash: string; email: string } | undefined;
  if (!u) return { ok: false, message: "Пользователь не найден." };
  const { verifyPassword } = await import("./db");
  if (!verifyPassword(password, u.password_hash)) return { ok: false, message: "Пароль неверный." };
  if (newEmail === u.email) return { ok: false, message: "Это уже ваш текущий email." };

  const exRes = await db.execute({ sql: "SELECT id FROM users WHERE email = ? AND active = 1", args: [newEmail] });
  if (exRes.rows[0]) return { ok: false, message: "Такой email уже зарегистрирован." };

  const token = randomBytes(24).toString("hex");
  await db.execute({
    sql: "UPDATE users SET pending_email = ?, pending_email_token = ?, pending_email_expires = ? WHERE id = ?",
    args: [newEmail, sha256(token), Math.floor(Date.now() / 1000) + 3600, user.id],
  });
  await audit(db, user.id, "email_change_requested", "user", user.id, `new=${newEmail}`);
  try {
    const { sendEmail } = await import("./email");
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://umzug-seven.vercel.app";
    await sendEmail(
      newEmail,
      "Подтвердите новый email — Umzug Service",
      `<div style="font-family:sans-serif;max-width:560px">
        <p>Вы запросили смену email в Umzug Service. Подтвердите смену по ссылке (действует 1 час):</p>
        <p><a href="${base}/account/email-change?token=${token}">Подтвердить смену email</a></p>
        <p style="color:#888;font-size:12px">Если это были не вы — просто проигнорируйте письмо, email не изменится.</p>
      </div>`,
    );
  } catch (e) {
    console.error("email-change mail failed:", e);
    return { ok: false, message: "Письмо не отправлено (демо-лимит Resend) — попробуйте позже." };
  }
  return { ok: true, message: "Письмо со ссылкой подтверждения отправлено на новый адрес." };
}

/**
 * Аудит #8: подтверждение смены email по одноразовой ссылке (1 час).
 * Меняет email только если новый адрес всё ещё свободен.
 */
export async function consumeEmailChangeToken(token: string): Promise<{ ok: boolean; message: string }> {
  const db = await getDb();
  const res = await db.execute({
    sql: "SELECT id, pending_email FROM users WHERE pending_email_token = ? AND pending_email_expires > ?",
    args: [sha256(token), Math.floor(Date.now() / 1000)],
  });
  const row = res.rows[0] as unknown as { id: number; pending_email: string } | undefined;
  if (!row) return { ok: false, message: "Ссылка недействительна или истекла." };
  const exRes = await db.execute({ sql: "SELECT id FROM users WHERE email = ? AND active = 1 AND id <> ?", args: [row.pending_email, Number(row.id)] });
  if (exRes.rows[0]) {
    await db.execute({
      sql: "UPDATE users SET pending_email = NULL, pending_email_token = NULL, pending_email_expires = NULL WHERE id = ?",
      args: [Number(row.id)],
    });
    return { ok: false, message: "Этот email уже занят другим аккаунтом." };
  }
  await db.execute({
    sql: "UPDATE users SET email = ?, email_verified = 1, pending_email = NULL, pending_email_token = NULL, pending_email_expires = NULL WHERE id = ?",
    args: [row.pending_email, Number(row.id)],
  });
  await audit(db, Number(row.id), "email_changed", "user", Number(row.id), `new=${row.pending_email}`);
  return { ok: true, message: "Email обновлён." };
}
