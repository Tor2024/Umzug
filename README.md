# Umzug Service

A production-grade web service for a German moving company (demo data): customers quote and book their move online, a dispatcher manages vehicles and crews, drivers track trip milestones from their smartphone, and accounting handles invoices and claims. Fully bilingual (German + Russian).

**Live:** https://umzug-seven.vercel.app

## What it does

**Customer (Kunde)**
- 3-step move calculator: route (OSRM/OSM geocoding, Leaflet map) → volume & floors → services (packing, kitchen disassembly, parking zones, express +25%, shared load −15%)
- Instant pricing from DB tariffs with a 14-day price snapshot
- Order page: status, crew, route map, invoices, PDFs (quote, handover protocol, invoice), event history with named actors, chat with the company
- Availability calendar, move acceptance confirmation, personal data export (GDPR Art. 15), account deletion (Art. 17)

**Dispatcher (Disponent)**
- Order board with filters, price & special-request confirmation
- ⚡ Auto-assignment: optimal vehicle + free crew (deadhead distance, availability, class)
- Manual assignment with drive-time/cost estimates, daily plan, trip timeline
- Subcontractors (hand-off to partner, margin tracking), "Where is the crew" live map
- Price revisions with customer approval flow

**Driver (Fahrer)**
- "My day": trips, one-tap departure on moving day (date guard)
- 5 trip checkpoints with geolocation (departed → at pickup → loaded → at drop-off → done) — customer and dispatcher see each step and the crew position on a map
- Loading checklist + digital handover protocol (planned/actual m³, signature, SHA hash, verifiable protocol chain)

**Accounting (Buchhaltung)**
- Invoices with automatic RE-JJJJ-0NNN numbering (GoBD-compliant), payments (SEPA/card/cash), dunning (2 levels, § 288 BGB), refunds, claims, subcontractor payouts, CSV export, analytics

**Admin**
- Tariffs, vehicle classes, fleet, driver-vehicle bindings, staff, subcontractors, Google Maps API key, full audit log

**Automation (cron)**
- 06:00 — customer reminders (down payment, invoice)
- 07:00 — morning emails to drivers (trip, vehicle, requirements), traffic-delay warnings (route re-check), admin digest (24h orders, overdue invoices, fleet utilization)

## Bilingual architecture

The German version is a complete mirror of every page under `/de/*` (landing, calculator, dashboard, role panels, legal pages). Russian lives without a prefix. A DE | RU switch sits in the header and sidebar; first-time visitors get the German version, and the choice is persisted in a cookie.

Approach: **no central i18n dictionary** — strings are co-located in each component (`const T = { ru: {...}, de: {...} }` next to the JSX), both locales share the exact same JSX (identical layout) and the same server actions and database. Russian UI strings on DE pages are excluded; server-side errors are mapped to German by error code.

## Legal framework (DE)

Impressum (§ 5 DDG), Datenschutz (GDPR, § 25 TDDDG — strictly necessary cookies only), AGB (HGB/BGB: pricing, obligations, down payment, liability €620/m³ per § 451 i.V.m. § 431 HGB, § 9 ArbZG), Widerrufsrecht (§§ 355/357 BGB).

## Tech stack

- **Next.js 16** (App Router, Cache Components, Turbopack) + **TypeScript** strict
- **Tailwind CSS 4**
- **Turso** (libsql) as the production database; server actions for all mutations
- **Resend** for email; **Vercel** for hosting + cron
- **Leaflet / react-leaflet** for maps; OSRM/OSM (optional Google) for routing
- **Playwright** for e2e (RU + DE smoke suites, 20 tests against production); **vitest** for unit tests (pricing, holidays, optimizer, validation)

## Getting started

```bash
pnpm install
pnpm exec vercel env pull .env.local --environment development --yes   # TURSO_*, RESEND_*, CRON_SECRET
pnpm dev
```

Checks: `pnpm exec tsc --noEmit` · `pnpm lint` · `pnpm vitest run` · `pnpm build` · e2e: `pnpm test:e2e` (production by default, override with `E2E_BASE_URL`).

Demo accounts (password `demo1234`): `klient@` / `logist@` / `voditel@` / `voditel2@` / `buh@` / `admin@example.com`.
