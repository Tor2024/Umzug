/**
 * Отправка email через Resend REST API (чистый fetch, без SDK).
 * Демо: from onboarding@resend.dev — работает без верификации домена,
 * но доставляет ТОЛЬКО на email владельца Resend-аккаунта.
 * Боевой режим: VERIFY_EMAIL_ENABLED=0 отключает отправку (ссылка на экране);
 * при подключении своего домена — DOMAIN + FROM_EMAIL env vars.
 *
 * Фирменный бланк (@1999): единый каркас brandedShell — лого в тёмном хедере,
 * оранжевая акцент-полоса, вежливый официальный тон, футер с реквизитами.
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

// ─── Фирменный бланк (@1999) ───────────────────────────────────────────────

const ORDER_URL_BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://umzug-seven.vercel.app";

/** Лого: фургон в оранжевом круге (совпадает с сайтом). SVG понимают Gmail/Apple/Яндекс. */
function logoSvg(): string {
  return `<svg width="36" height="36" viewBox="0 0 64 64" style="display:block;border-radius:50%;" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="#EA7A28"/><g transform="translate(13.5,17.5)" stroke="#ffffff" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M 3 20 L 3 12 Q 3 4 12 4 L 27 4 Q 32 4 35 9 L 38 14 Q 39 16 39 20 L 37 20"/><path d="M 3 20 L 5 20"/><circle cx="11" cy="22" r="3.4"/><circle cx="29" cy="22" r="3.4"/><path d="M 15 22 L 25 22"/></g></svg>`;
}

export interface ShellOpts {
  /** Абзац-приветствие (уже с escapeHtml, если нужно). */
  greeting?: string;
  /** Основной HTML-контент (абзацы). */
  bodyHtml: string;
  /** Кнопка-действие (одна). */
  actionUrl?: string;
  actionLabel?: string;
  /** Мелкий текст под кнопкой (fallback-ссылка, примечание). */
  noteHtml?: string;
}

/**
 * Единый фирменный бланк: тёмный хедер с лого, оранжевая полоса,
 * контент, футер с реквизитами и вежливой подписью.
 */
function brandedShell({ greeting, bodyHtml, actionUrl, actionLabel, noteHtml }: ShellOpts): string {
  const button = actionUrl && actionLabel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0;"><tr><td style="background:#EA7A28;border-radius:8px;">
         <a href="${actionUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">${actionLabel}</a>
       </td></tr></table>`
    : "";
  const note = noteHtml
    ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">${noteHtml}</p>`
    : "";
  return `<!doctype html>
<html lang="ru"><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1a1d21;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#0f172a;padding:18px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:12px;">${logoSvg()}</td>
        <td style="vertical-align:middle;">
          <span style="color:#ffffff;font-size:17px;font-weight:bold;">Umzug Service</span><br>
          <span style="color:#94a3b8;font-size:12px;">Umzüge in Deutschland — ohne Überraschungen</span>
        </td>
      </tr></table>
    </div>
    <div style="height:3px;background:#EA7A28;"></div>
    <div style="padding:28px;">
      ${greeting ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">${greeting}</p>` : ""}
      ${bodyHtml}
      ${button}
      ${note}
      <p style="margin:24px 0 0;font-size:14px;line-height:1.5;color:#374151;">С уважением,<br>команда <b>Umzug Service</b></p>
    </div>
    <div style="background:#0f172a;padding:16px 28px;">
      <p style="margin:0;font-size:12px;color:#cbd5e1;line-height:1.6;">
        <b style="color:#ffffff;">Umzug Service GmbH</b> · Musterstraße 12, 10115 Berlin<br>
        <a href="tel:+4930000000000" style="color:#94a3b8;text-decoration:none;">+49 (0)30 000 000 00</a> ·
        <a href="mailto:info@umzugservice.example" style="color:#94a3b8;text-decoration:none;">info@umzugservice.example</a> ·
        <a href="${ORDER_URL_BASE}" style="color:#EA7A28;text-decoration:none;">umzug-seven.vercel.app</a>
      </p>
    </div>
  </div>
</body></html>`;
}

/** Fallback-ссылка для писем с кнопкой (мелким текстом). */
function fallbackLink(url: string): string {
  return `Если кнопка не работает, скопируйте ссылку в браузер:<br><a href="${url}" style="color:#EA7A28;word-break:break-all;">${url}</a>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function fmtEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

// ─── Аккаунт: подтверждение email, сброс пароля ───────────────────────────

/** Письмо подтверждения регистрации. */
export async function sendVerifyEmail(to: string, name: string, token: string): Promise<SendResult> {
  const verifyUrl = `${ORDER_URL_BASE}/verify?token=${token}`;
  const html = brandedShell({
    greeting: `Здравствуйте, ${escapeHtml(name)}!`,
    bodyHtml: `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Благодарим за регистрацию в Umzug Service. Остался последний шаг — подтвердите ваш email, нажав кнопку ниже.</p>`,
    actionUrl: verifyUrl,
    actionLabel: "Подтвердить email",
    noteHtml: `${fallbackLink(verifyUrl)}<br><br>Ссылка действует 24 часа. Если вы не регистрировались — просто проигнорируйте это письмо.`,
  });
  return sendEmail(to, "Подтвердите email — Umzug Service", html);
}

/** Письмо восстановления пароля: ссылка действует 1 час. */
export async function sendResetEmail(to: string, name: string, token: string): Promise<SendResult> {
  const resetUrl = `${ORDER_URL_BASE}/reset-password?token=${token}`;
  const html = brandedShell({
    greeting: `Здравствуйте, ${escapeHtml(name)}!`,
    bodyHtml: `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Вы запросили восстановление пароля. Нажмите кнопку ниже и задайте новый пароль.</p>`,
    actionUrl: resetUrl,
    actionLabel: "Задать новый пароль",
    noteHtml: `${fallbackLink(resetUrl)}<br><br>Ссылка действует <b>1 час</b>. Если вы не запрашивали сброс — просто проигнорируйте это письмо, пароль останется прежним.`,
  });
  return sendEmail(to, "Восстановление пароля — Umzug Service", html);
}

// ─── Уведомления о статусе заказа (клиенту) ───────────────────────────────

/** Общий каркас статусных писем: greeting + body + кнопка «Открыть заявку» (или своя ссылка). */
function statusTemplate(
  greeting: string,
  bodyHtml: string,
  orderRef: string,
  action?: { url: string; label: string },
): string {
  return brandedShell({
    greeting,
    bodyHtml,
    actionUrl: action?.url ?? `${ORDER_URL_BASE}/order/${orderRef}`,
    actionLabel: action?.label ?? `Открыть заявку ${orderRef}`,
  });
}

/** Заявка создана (new) — сразу после отправки из калькулятора. */
export async function sendOrderCreatedEmail(to: string, name: string, ref: string, grossCents: number, moveDate: string): Promise<SendResult> {
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! Ваша заявка принята — спасибо за доверие.`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Заявка <b>${ref}</b> на переезд ${escapeHtml(moveDate)} создана. Предварительная стоимость: <b>${fmtEuro(grossCents)}</b> (включая НДС).</p>
     <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Наш логист внимательно проверит расчёт и подтвердит цену — мы сообщим вам письмом. Смета действует 14 дней.</p>`,
    ref,
  );
  return sendEmail(to, `Заявка ${ref} принята — Umzug Service`, html);
}

/** Логист подтвердил цену (confirmed). */
export async function sendOrderConfirmedEmail(to: string, name: string, ref: string, grossCents: number, depositCents: number): Promise<SendResult> {
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! Рад сообщить: цена по заявке ${ref} подтверждена.`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Итоговая стоимость: <b>${fmtEuro(grossCents)}</b>, аванс 30%: <b>${fmtEuro(depositCents)}</b>.</p>
     <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Следующий шаг — мы назначим машину и экипаж. Аванс удобно оплатить по реквизитам на странице заявки.</p>`,
    ref,
  );
  return sendEmail(to, `Цена по заявке ${ref} подтверждена — Umzug Service`, html);
}

/** Машина и экипаж назначены (assigned). */
export async function sendOrderAssignedEmail(to: string, name: string, ref: string, moveDate: string): Promise<SendResult> {
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! По заявке ${ref} назначены машина и экипаж.`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Дата переезда: <b>${escapeHtml(moveDate)}</b>. Состав бригады виден на странице заявки.</p>
     <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Ваш водитель свяжется с вами накануне переезда. Пожалуйста, будьте на связи — и лёгкого переезда!</p>`,
    ref,
  );
  return sendEmail(to, `Бригада назначена — заявка ${ref} — Umzug Service`, html);
}

/** Переезд завершён, счёт создан (closed + invoice): кнопка ведёт на PDF счёта. */
export async function sendInvoiceEmail(to: string, name: string, ref: string, invoiceNumber: string, grossCents: number, dueDate: string): Promise<SendResult> {
  const pdfUrl = `${ORDER_URL_BASE}/api/pdf/invoice/${invoiceNumber}`;
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! Переезд по заявке ${ref} успешно завершён.`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Счёт <b>${invoiceNumber}</b> на сумму <b>${fmtEuro(grossCents)}</b> создан. Срок оплаты: <b>${escapeHtml(dueDate)}</b>.</p>
     <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">PDF-версия счёта — по кнопке ниже или на странице заявки. Благодарим за сотрудничество!</p>`,
    ref,
    { url: pdfUrl, label: `Скачать счёт ${invoiceNumber} (PDF)` },
  );
  return sendEmail(to, `Счёт ${invoiceNumber} — Umzug Service`, html);
}

/** Клиент подтвердил приёмку (acceptance). */
export async function sendAcceptanceEmail(to: string, name: string, ref: string): Promise<SendResult> {
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! Приёмка по заявке ${ref} подтверждена.`,
    `<p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Спасибо! Если что-то не так — просто ответьте на это письмо или напишите нам в переписке по заявке, мы всё исправим.</p>`,
    ref,
  );
  return sendEmail(to, `Приёмка подтверждена — заявка ${ref} — Umzug Service`, html);
}

/** Заявка отменена (cancelled). */
export async function sendOrderCancelledEmail(to: string, name: string, ref: string): Promise<SendResult> {
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! Заявка ${ref} отменена.`,
    `<p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Если отмена не от вас — пожалуйста, ответьте на это письмо как можно скорее, разберёмся.</p>`,
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
     <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Пожалуйста, дождитесь подтверждения или свяжитесь с нами — будем рады помочь. Без подтверждения машина на эту дату не закреплена.</p>`,
    ref,
  );
  const subject = kind === "48h"
    ? `Заявка ${ref}: до переезда ~2 дня, заявка не подтверждена — Umzug Service`
    : `Заявка ${ref}: переезд завтра, заявка не подтверждена — Umzug Service`;
  return sendEmail(to, subject, html);
}

// ─── Утренний cron (0 7 * * *) ─────────────────────────────────────────────

/** №8: водителю о сегодняшней поездке (реф, время, адреса, машина, требования). */
export async function sendDriverMorningEmail(
  to: string, driverName: string, ref: string, startTime: string,
  fromText: string, toText: string, vehicle: string,
  requirements: string | null, selfPack: boolean,
): Promise<SendResult> {
  const time = startTime || "08:00";
  const packLine = selfPack
    ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#b45309;"><b>Клиент упаковывает сам</b> — упаковочная услуга не требуется, только погрузка/разгрузка.</p>`
    : "";
  const reqHtml = requirements
    ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;"><b>Согласованные доп. требования:</b><br>${escapeHtml(requirements)}</p>`
    : "";
  const html = brandedShell({
    greeting: `Доброе утро, ${escapeHtml(driverName)}! Сегодня у вас поездка по заявке <b>${ref}</b>.`,
    bodyHtml: `<table role="presentation" cellpadding="6" style="font-size:14px;line-height:1.5;color:#374151;">
        <tr><td><b>Время начала:</b></td><td><b>${escapeHtml(time)}</b></td></tr>
        <tr><td><b>Погрузка:</b></td><td>${escapeHtml(fromText)}</td></tr>
        <tr><td><b>Разгрузка:</b></td><td>${escapeHtml(toText)}</td></tr>
        <tr><td><b>Машина:</b></td><td>${escapeHtml(vehicle)}</td></tr>
      </table>
      ${packLine}${reqHtml}
      <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Отмечайте этапы поездки на странице водителя — клиент видит статус в реальном времени.</p>`,
    actionUrl: `${ORDER_URL_BASE}/driver`,
    actionLabel: "Открыть страницу водителя",
  });
  return sendEmail(to, `Сегодняшняя поездка ${ref}, начало ${time} — Umzug Service`, html);
}

/** №6: клиенту — предупреждение о дорожной задержке (пересчёт маршрута утром). */
export async function sendTrafficDelayEmail(
  to: string, name: string, ref: string, expectedMin: number, actualMin: number,
): Promise<SendResult> {
  const extra = Math.max(0, actualMin - expectedMin);
  const html = statusTemplate(
    `Здравствуйте, ${escapeHtml(name)}! Информируем о возможной задержке по заявке ${ref}.`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Утренний мониторинг дорожной обстановки показал осложнение на маршруте: время в пути сейчас ориентировочно <b>${actualMin} мин</b> вместо ожидаемых ${expectedMin} мин (+~${extra} мин).</p>
     <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Ваш экипаж постарается компенсировать задержку — водитель свяжется с вами при значительном сдвиге графика. Приносим извинения за возможные неудобства.</p>`,
    ref,
  );
  return sendEmail(to, `Возможна задержка по заявке ${ref} — Umzug Service`, html);
}

function digestRow(label: string, count: number, warn = false): string {
  if (!count) return "";
  const color = warn ? "#b91c1c" : "#374151";
  return `<tr><td style="padding:4px 12px 4px 0;font-size:14px;color:#6b7280;">${label}</td>
               <td style="padding:4px 0;font-size:14px;font-weight:bold;color:${color};text-align:right;">${count}</td></tr>`;
}

/** №10: админу — дайджест за сутки (статусы, счета, незаназначенные, парк). */
export async function sendAdminDigestEmail(
  to: string, byStatus: Record<string, number>, overdueCount: number,
  unassignedCount: number, fleetBusy: number, fleetTotal: number,
): Promise<SendResult> {
  const statusLabels: Record<string, string> = {
    new: "Новые заявки", confirmed: "Подтверждённые", assigned: "Назначенные",
    enroute: "В пути", acceptance: "На приёмке", closed: "Завершённые", cancelled: "Отменённые",
  };
  const statusRows = Object.entries(statusLabels)
    .map(([k, label]) => digestRow(label, byStatus[k] ?? 0, k === "new" && (byStatus[k] ?? 0) > 0))
    .join("");
  const fleetTxt = fleetTotal > 0 ? `${fleetBusy} из ${fleetTotal} машин занято сегодня` : "Нет данных по парку";
  const html = brandedShell({
    greeting: `Доброе утро! Сводка по Umzug Service за последние сутки.`,
    bodyHtml: `<table role="presentation" style="margin:0 0 16px;">${statusRows}</table>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">
        <b>Просроченные счета:</b> <span style="color:${overdueCount ? "#b91c1c" : "inherit"};font-weight:bold;">${overdueCount}</span><br>
        <b>Незаназначенные на ближайшие 48ч:</b> <span style="color:${unassignedCount ? "#b45309" : "inherit"};font-weight:bold;">${unassignedCount}</span><br>
        <b>Парк:</b> ${escapeHtml(fleetTxt)}
      </p>`,
    actionUrl: `${ORDER_URL_BASE}/dispatch`,
    actionLabel: "Открыть диспетчерскую",
  });
  return sendEmail(to, `Утренний дайджест — Umzug Service`, html);
}

// ─── Сообщения переписки (staff → клиент) ─────────────────────────────────

/** Экспортировано для sendMessageAction (actions.ts): письмо о новом ответе сотрудника. */
export function threadMessageTemplate(name: string, ref: string, fromLabel: string, body: string): string {
  return brandedShell({
    greeting: `Здравствуйте, ${escapeHtml(name)}!`,
    bodyHtml: `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Новое сообщение в переписке по заявке <b>${ref}</b> — ${escapeHtml(fromLabel === "Наша команда" ? "нам" : "от вас")}:</p>
     <blockquote style="margin:0 0 12px;padding:12px 16px;border-left:3px solid #EA7A28;background:#fff7ed;border-radius:0 8px 8px 0;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(body)}</blockquote>`,
    noteHtml: `Ответить можно прямо на странице заявки — будем рады помочь.`,
  });
}

/** Дуннинг-письмо (просрочка оплаты счёта). Экспортировано для dunningRefreshAction. */
export function dunningTemplate(name: string, invoiceNumber: string, ref: string, daysTxt: string): string {
  const orderUrl = `${ORDER_URL_BASE}/order/${ref}`;
  return brandedShell({
    greeting: `Уважаемый(-ая) ${escapeHtml(name)}!`,
    bodyHtml: `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Обращаем ваше внимание: оплата по счёту <b>${escapeHtml(invoiceNumber)}</b> (заявка ${ref}) просрочена на ${escapeHtml(daysTxt)}.</p>
     <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">Просим погасить задолженность в удобный срок либо связаться с нами — мы обязательно найдём решение.</p>`,
    actionUrl: orderUrl,
    actionLabel: `Открыть заявку ${ref}`,
  });
}
