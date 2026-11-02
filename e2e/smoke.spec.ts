import { test, expect, type Page } from "@playwright/test";

/** E2E: ключевые флоу прода против живого окружения (или локального dev).
 *  Требует BASE_URL с засеянной БД (демо-юзеры, пароль demo1234).
 *  Порядок важен (workers=1): login → order → dispatch → finance.
 */

const PW = "demo1234";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 });
}

test.describe.serial("auth", () => {
  test("логин клиента → /account", async ({ page }) => {
    await login(page, "klient@example.com");
    await expect(page).toHaveURL(/\/account/);
    await expect(page.getByText("Анна Сафрова · klient@example.com")).toBeVisible();
  });

  test("неверный пароль → сообщение об ошибке", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "klient@example.com");
    await page.fill('input[name="password"]', "wrong-password");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    await expect(page.locator("body")).toContainText(/неверн/i);
  });

  test("forgot-password → экран «проверьте почту»", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.fill('input[name="email"]', "klient@example.com");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    await expect(page.locator("body")).toContainText(/проверьте почту/i);
  });
});

test.describe.serial("calc и заявка", () => {
  test("калькулятор показывает предварительный расчёт", async ({ page }) => {
    await page.goto("/calc");
    await expect(page.locator("body")).toContainText(/база/i);
    await expect(page.locator("body")).toContainText(/€/);
  });

  test("страница заказа без входа → экран «Нужно войти»", async ({ page }) => {
    await page.goto("/order/MS-0000-0000");
    await expect(page.locator("body")).toContainText(/нужно войти/i);
    await expect(page.locator('a[href*="/login"]')).toBeVisible();
  });
});

test.describe.serial("роли", () => {
  test("логист → /dispatch", async ({ page }) => {
    await login(page, "logist@example.com");
    await expect(page).toHaveURL(/\/dispatch/);
    await expect(page.getByRole("heading", { name: "Панель логиста" })).toBeVisible();
  });

  test("водитель → /driver", async ({ page }) => {
    await login(page, "voditel@example.com");
    await expect(page).toHaveURL(/\/driver/);
    await expect(page.locator("body")).toContainText(/мой день/i);
  });

  test("бухгалтер → /finance", async ({ page }) => {
    await login(page, "buh@example.com");
    await expect(page).toHaveURL(/\/finance/);
    await expect(page.getByText("Бухгалтерия").first()).toBeVisible();
  });

  test("админ → /admin", async ({ page }) => {
    await login(page, "admin@example.com");
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.locator("body")).toContainText(/админ/i);
  });

  test("клиент не попадает в /dispatch (роль-гвард)", async ({ page }) => {
    await login(page, "klient@example.com");
    await page.goto("/dispatch");
    await page.waitForTimeout(2500);
    expect(page.url()).not.toMatch(/dispatch/);
  });
});
