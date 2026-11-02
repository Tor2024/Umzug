/**
 * Валидация имени клиента (латиница, требование: PDF-документы на немецком,
 * имя попадает в Rechnung/Protokoll). Формат: 2+ слова (имя и фамилия),
 * каждое 2–40 символов, буквы A-Z/a-z, дефис, апостроф; точки допустимы.
 * Отдельный модуль (не "use server") — синхронный экспорт + юнит-тесты.
 */
export function isValidLatinName(name: string): boolean {
  const parts = name.split(" ");
  if (parts.length < 2) return false;
  return parts.every(
    (p) =>
      p.length >= 2 &&
      p.length <= 40 &&
      /^[A-Za-z][A-Za-z'.-]*$/.test(p) &&
      /[A-Za-z]{2}/.test(p),
  );
}

/**
 * Телефон клиента (немецкий формат): +49… или 0…, 7–14 цифр после префикса.
 * Пробелы/дефисы/скобки допускаются и нормализуются. Требование: логист
 * согласует детали переезда по телефону; шуточные заказы отсекаются.
 */
export function isValidGermanPhone(raw: string): boolean {
  const p = raw.replace(/[\s\-/().]/g, "");
  if (/^\+49\d{7,14}$/.test(p)) return true;
  if (/^0\d{8,14}$/.test(p)) return true;
  return false;
}
