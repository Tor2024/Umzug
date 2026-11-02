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
