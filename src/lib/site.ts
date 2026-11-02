/**
 * Публичные данные компании. ДЕМО-значения — заменить перед продакшеном.
 * Название компании хранится в config (company.name) и захардкожено здесь для
 * статического рендера (D8.9: редактор company.name — CUT).
 */
export const SITE = {
  name: "Umzug Service GmbH",
  short: "Umzug Service",
  tagline: "Umzüge in Deutschland ohne Überraschungen",
  phone: "+49 (0)30 000 000 00",
  phoneHref: "tel:+49030000000000",
  email: "info@umzugservice.example",
  address: "Musterstraße 12, 10115 Berlin",
  // Демо-реквизиты (Impressum, § 5 DDG) — заменить реальными перед запуском
  hrb: "HRB 000 000 B (AG Charlottenburg) — Demo",
  ceo: "—",
  vatId: "DE 000 000 000 — Demo",
  liability: "Haftung nach HGB: Erstattung 620 € pro m³ (§ 451 i.V.m. § 431 HGB).",
} as const;
