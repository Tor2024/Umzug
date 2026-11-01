/**
 * Отправка email через Resend REST API (чистый fetch, без SDK).
 * Демо: from onboarding@resend.dev — работает без верификации домена,
 * но доставляет ТОЛЬКО на email владельца Resend-аккаунта.
 * Боевой режим: VERIFY_EMAIL_ENABLED=0 отключает отправку (ссылка на экране);
 * при подключении своего домена — DOMAIN + FROM_EMAIL env vars.
 */

const RESEND_API = "https://api.resend.com/emails";

export interface SendResult {
  sent: boolean;
  reason?: string; // причина, когда письмо не отправлено (для логов/UX)
}

/** Базовая отправка. Возвращает ошибку, а не бросает — регистрация не должна падать из-за SMTP. */
async function sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "no_api_key" };

  const from = process.env.FROM_EMAIL ?? "Помощник с переездом <onboarding@resend.dev>";

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] Resend ${res.status}: ${body.slice(0, 300)}`);
      return { sent: false, reason: `resend_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("[email] send failed:", err instanceof Error ? err.message : err);
    return { sent: false, reason: "network" };
  }
}

function verifyTemplate(name: string, verifyUrl: string): string {
  return `<!doctype html>
<html lang="ru"><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1a1d21;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 16px;font-size:20px;">Помощник с переездом</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Здравствуйте, ${escapeHtml(name)}!</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">Подтвердите ваш email — нажмите кнопку ниже. Ссылка действует 24 часа.</p>
    <a href="${verifyUrl}" style="display:inline-block;background:#1a56db;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:bold;">Подтвердить email</a>
    <p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Если кнопка не работает, скопируйте ссылку в браузер:<br><a href="${verifyUrl}" style="color:#1a56db;word-break:break-all;">${verifyUrl}</a></p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">Если вы не регистрировались — просто проигнорируйте это письмо.</p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Письмо подтверждения регистрации. */
export async function sendVerifyEmail(to: string, name: string, token: string): Promise<SendResult> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://umzug-seven.vercel.app";
  const verifyUrl = `${base}/verify?token=${token}`;
  return sendEmail(to, "Подтвердите email — Помощник с переездом", verifyTemplate(name, verifyUrl));
}
