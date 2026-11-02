// Smoke-тесты DE-версии (этапы 1–3): публичные + dash страницы.
// Локально: pnpm start --port 3111 → pnpm exec playwright test e2e/smoke-de.spec.ts
// CI/прод: E2E_BASE_URL=https://umzug-seven.vercel.app pnpm exec playwright test e2e/smoke-de.spec.ts
import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3111";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto(`${BASE}/de/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/de/login"), { timeout: 20000 });
  await page.waitForTimeout(2000);
}

test.describe("DE smoke", () => {
  test("DE landing has German hero and switch", async ({ page }) => {
    await page.goto(`${BASE}/de`, { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toContainText(/Umzug/i);
    const body = await page.locator("body").textContent();
    expect(body).toContain("So funktioniert");
  });

  test("DE calc page renders wizard in German", async ({ page }) => {
    await page.goto(`${BASE}/de/calc`, { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toContainText(/Umzug berechnen/i);
    const body = await page.locator("body").textContent();
    expect(body).toContain("Strecke");
    expect(body).toContain("Vorläufige Berechnung");
  });

  test("DE login page is German", async ({ page }) => {
    await page.goto(`${BASE}/de/login`, { waitUntil: "networkidle" });
    const body = await page.locator("body").textContent();
    expect(body).toContain("Anmelden");
    expect(body).toContain("Demo-Zugänge");
  });

  test("kunde login DE sees /de/account Kundenkonto", async ({ page }) => {
    await login(page, "klient@example.com");
    await page.goto(`${BASE}/de/account`, { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toContainText(/Kundenkonto/i);
    const body = await page.locator("body").textContent();
    expect(body).toContain("Meine Anfragen");
  });

  test("logist login DE sees /de/dispatch", async ({ page }) => {
    await login(page, "logist@example.com");
    await page.goto(`${BASE}/de/dispatch`, { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toContainText(/Disposition/i);
  });

  test("driver login DE sees /de/driver Mein Tag", async ({ page }) => {
    await login(page, "voditel@example.com");
    await page.goto(`${BASE}/de/driver`, { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toContainText(/Mein Tag/i);
  });

  test("buh login DE sees /de/finance", async ({ page }) => {
    await login(page, "buh@example.com");
    await page.goto(`${BASE}/de/finance`, { waitUntil: "networkidle" });
    const body = await page.locator("body").textContent();
    expect(body).toMatch(/Rechnungsregister|Buchhaltung|Finanzaufgaben/);
  });

  test("admin login DE sees /de/admin Tarife", async ({ page }) => {
    await login(page, "admin@example.com");
    await page.goto(`${BASE}/de/admin`, { waitUntil: "networkidle" });
    const body = await page.locator("body").textContent();
    expect(body).toContain("Tarife");
  });

  test("DE order page shows auth guard or not-found", async ({ page }) => {
    await page.goto(`${BASE}/de/order/MS-0000-0000`, { waitUntil: "networkidle" });
    const body = await page.locator("body").textContent();
    expect(body).toMatch(/anmelden|nicht gefunden|Kein Zugriff/i);
  });

  test("DE legal pages exist", async ({ page }) => {
    for (const p of ["impressum", "datenschutz", "agb", "widerruf"]) {
      const res = await page.goto(`${BASE}/de/${p}`, { waitUntil: "domcontentloaded" });
      if (!res) throw new Error(`no response for ${p}`);
      expect(res.status()).toBe(200);
    }
  });
});
