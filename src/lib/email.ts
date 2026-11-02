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
export async function sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "no_api_key" };

  const from = process.env.FROM_EMAIL ?? "Umzug Service <onboarding@resend.dev>";

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
    <h1 style="margin:0 0 16px;font-size:20px;">Umzug Service</h1>
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
  return sendEmail(to, "Подтвердите email — Umzug Service", verifyTemplate(name, verifyUrl));
}

/** Письмо восстановления пароля: ссылка действует 1 час. */
export async function sendResetEmail(to: string, name: string, token: string): Promise<SendResult> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://umzug-seven.vercel.app";
  const resetUrl = `${base}/reset-password?token=${token}`;
  return sendEmail(to, "Восстановление пароля — Umzug Service", resetTemplate(name, resetUrl));
}

function resetTemplate(name: string, resetUrl: string): string {
  return `<!doctype html>
<html lang="ru"><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1a1d21;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 16px;font-size:20px;">Umzug Service</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Здравствуйте, ${escapeHtml(name)}!</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">Вы запросили восстановление пароля. Нажмите кнопку ниже и задайте новый пароль. Ссылка действует <b>1 час</b>.</p>
    <a href="${resetUrl}" style="display:inline-block;background:#1a56db;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:bold;">Задать новый пароль</a>
    <p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Если кнопка не работает, скопируйте ссылку в браузер:<br><a href="${resetUrl}" style="color:#1a56db;word-break:break-all;">${resetUrl}</a></p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо, пароль останется прежним.</p>
  </div>
</body></html>`;
}

// ─── Уведомления о статусе заказа (клиенту) ───────────────────────────────

const ORDER_URL_BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://umzug-seven.vercel.app";

/** Общий каркас статусных писем. */
function statusTemplate(title: string, bodyHtml: string, orderRef: string): string {
  const orderUrl = `${ORDER_URL_BASE}/order/${orderRef}`;
  return `<!doctype html>
<html lang="ru"><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1a1d21;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 16px;font-size:20px;">Umzug Service</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">${title}</p>
    ${bodyHtml}
    <p style="margin:20px 0 0;">
      <a href="${orderUrl}" style="display:inline-block;background:#EA7A28;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:bold;">Открыть заявку ${orderRef}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">Umzug Service GmbH · Umzüge in Deutschland ohne Überraschungen</p>
  </div>
</body></html>`;
}

function fmtEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

/** Заявка создана (new) — сразу после отправки из калькулятора. */
export async function sendOrderCreatedEmail(to: string, name: string, ref: string, grossCents: number, moveDate: string): Promise<SendResult> {
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! Ваша заявка принята.`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Заявка <b>${ref}</b> на переезд ${escapeHtml(moveDate)} создана. Предварительная стоимость: <b>${fmtEuro(grossCents)}</b> (включая НДС).</p>
     <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Логист проверит расчёт и подтвердит цену — уведомим вас письмом. Смета действует 14 дней.</p>`,
    ref,
  );
  return sendEmail(to, `Заявка ${ref} принята — Umzug Service`, html);
}

/** Логист подтвердил цену (confirmed). */
export async function sendOrderConfirmedEmail(to: string, name: string, ref: string, grossCents: number, depositCents: number): Promise<SendResult> {
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! Цена по заявке ${ref} подтверждена.`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Итоговая стоимость: <b>${fmtEuro(grossCents)}</b>, аванс 30%: <b>${fmtEuro(depositCents)}</b>.</p>
     <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Следующий шаг — назначение машины и экипажа. Аванс можно оплатить по реквизитам в заявке.</p>`,
    ref,
  );
  return sendEmail(to, `Цена по заявке ${ref} подтверждена — Umzug Service`, html);
}

/** Машина и экипаж назначены (assigned). */
export async function sendOrderAssignedEmail(to: string, name: string, ref: string, moveDate: string): Promise<SendResult> {
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! По заявке ${ref} назначены машина и экипаж.`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Дата переезда: <b>${escapeHtml(moveDate)}</b>. Состав бригады виден на странице заявки.</p>
     <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Водитель свяжется с вами перед выездом. Пожалуйста, будьте на связи.</p>`,
    ref,
  );
  return sendEmail(to, `Бригада назначена — заявка ${ref} — Umzug Service`, html);
}

/** Переезд завершён, счёт создан (closed + invoice). */
export async function sendInvoiceEmail(to: string, name: string, ref: string, invoiceNumber: string, grossCents: number, dueDate: string): Promise<SendResult> {
  const pdfUrl = `${ORDER_URL_BASE}/api/pdf/invoice/${invoiceNumber}`;
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! Переезд по заявке ${ref} завершён.`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Счёт <b>${invoiceNumber}</b> на сумму <b>${fmtEuro(grossCents)}</b> создан. Срок оплаты: <b>${escapeHtml(dueDate)}</b>.</p>
     <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Реквизиты и PDF — по кнопке ниже или на странице заявки.</p>`,
    ref,
  ).replace(`href="${ORDER_URL_BASE}/order/${ref}"`, `href="${pdfUrl}"`);
  return sendEmail(to, `Счёт ${invoiceNumber} — Umzug Service`, html);
}

/** Клиент подтвердил приёмку (acceptance). */
export async function sendAcceptanceEmail(to: string, name: string, ref: string): Promise<SendResult> {
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! Приёмка по заявке ${ref} подтверждена.`,
    `<p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Спасибо! Если что-то не так — ответьте на это письмо или напишите в переписке по заявке.</p>`,
    ref,
  );
  return sendEmail(to, `Приёмка подтверждена — заявка ${ref} — Umzug Service`, html);
}

/** Заявка отменена (cancelled). */
export async function sendOrderCancelledEmail(to: string, name: string, ref: string): Promise<SendResult> {
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! Заявка ${ref} отменена.`,
    `<p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Если отмена не от вас — ответьте на это письмо как можно скорее.</p>`,
    ref,
  );
  return sendEmail(to, `Заявка ${ref} отменена — Umzug Service`, html);
}

/** Напоминание о неподтверждённой заявке (cron, за 48ч и 24ч до переезда). */
export async function sendOrderReminderEmail(
  to: string, name: string, ref: string, moveDate: string, kind: "48h" | "24h",
): Promise<SendResult> {
  const when = kind === "48h"
    ? "До переезда осталось около двух дней"
    : "Переезд уже завтра";
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! ${when}, а заявка ${ref} ещё не подтверждена.`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Дата переезда: <b>${escapeHtml(moveDate)}</b>. Заявка всё ещё в статусе «новая» — логист ещё не подтвердил цену.</p>
     <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Пожалуйста, дождитесь подтверждения цены или свяжитесь с нами. Без подтверждения машина на эту дату не закреплена.</p>`,
    ref,
  );
  const subject = kind === "48h"
    ? `Заявка ${ref}: до переезда ~2 дня, заявка не подтверждена — Umzug Service`
    : `Заявка ${ref}: переезд завтра, заявка не подтверждена — Umzug Service`;
  return sendEmail(to, subject, html);
}
