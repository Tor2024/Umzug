/**
 * Публичные данные компании. ДЕМО-значения — заменить перед продакшеном.
 * Название компании хранится в config (company.name) и захардкожено здесь для
 * статического рендера (D8.9: редактор company.name — CUT).
 */
export const SITE = {
  name: "Помощник с переездом GmbH",
  short: "Помощник с переездом",
  tagline: "Переезд по Германии без сюрпризов",
  phone: "+49 (0)30 000 000 00",
  phoneHref: "tel:+49030000000000",
  email: "info@pomoshnik-pereezd.example",
  address: "Musterstraße 12, 10115 Berlin",
  // Демо-реквизиты (Impressum, § 5 DDG) — заменить реальными перед запуском
  hrb: "HRB 000 000 B (AG Charlottenburg) — демо",
  ceo: "—",
  vatId: "DE 000 000 000 — демо",
  liability: "Груз застрахован по HGB: возмещение 620 € за м³ (§ 451 i.V.m. § 431 HGB).",
} as const;
