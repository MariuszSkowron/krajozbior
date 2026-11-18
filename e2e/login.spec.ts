import { expect, test } from "@playwright/test";

const password = process.env.DEMO_ACCOUNT_PASSWORD;
// Read before playwright.config.ts adds its fallback: only a real database counts.
const hasDatabase = Boolean(process.env.DATABASE_URL);

test("a guest opening a private page is sent to login", async ({ page }) => {
  // Better Auth checks the database schema on first use, even for a guest.
  test.skip(!hasDatabase, "DATABASE_URL with a migrated database is required");

  await page.goto("/my");

  await expect(page).toHaveURL(/\/login\?returnTo=%2Fmy$/);
  await expect(page).toHaveTitle("Logowanie — Krajozbiór");
  await expect(page.getByRole("heading", { level: 1, name: "Logowanie" })).toBeVisible();
  await expect(page.getByLabel("E-mail").first()).toBeVisible();
});

// These also need seeded accounts; the CI e2e job provides database and seed.
test.describe("with seeded demo accounts", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  async function logIn(page: import("@playwright/test").Page, email: string, pass: string) {
    const form = page.locator("form", { has: page.getByLabel("Hasło") });

    await form.getByLabel("E-mail").fill(email);
    await form.getByLabel("Hasło").fill(pass);
    await form.getByRole("button", { name: "Zaloguj się" }).click();
  }

  test("a demo user logs in, returns to the page and is refused the admin route", async ({
    page,
    request,
  }) => {
    await page.goto("/my");
    await logIn(page, "user@demo.krajozbior.local", password ?? "");

    await expect(page).toHaveURL(/\/my$/);
    await expect(page.getByRole("heading", { level: 1, name: "Moje konto" })).toBeVisible();

    const me = await page.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).role).toBe("user");
    expect((await page.request.get("/api/admin")).status()).toBe(403);

    // A separate client without the session cookie is still a guest.
    expect((await request.get("/api/admin")).status()).toBe(401);
  });

  test("an admin can use the admin route", async ({ page }) => {
    await page.goto("/login");
    await logIn(page, "admin@demo.krajozbior.local", password ?? "");

    await expect(page).toHaveURL(/\/my$/);
    const response = await page.request.get("/api/admin");
    expect(response.status()).toBe(200);
    expect((await response.json()).role).toBe("admin");
  });

  test("wrong credentials show a generic error and keep the guest signed out", async ({ page }) => {
    await page.goto("/login");
    await logIn(page, "user@demo.krajozbior.local", "definitely-not-the-password");

    await expect(page.locator("main [role=alert]")).toContainText(
      "Nieprawidłowy e-mail lub hasło.",
    );
    expect((await page.request.get("/api/me")).status()).toBe(401);
  });

  test("a signed-in user can log out", async ({ page }) => {
    await page.goto("/login");
    await logIn(page, "user@demo.krajozbior.local", password ?? "");
    await expect(page).toHaveURL(/\/my$/);

    await page.getByRole("banner").getByRole("button", { name: "Wyloguj" }).click();

    await expect(page).toHaveURL(/\/\?wylogowano=1$/);
    expect((await page.request.get("/api/me")).status()).toBe(401);
  });

  test("the production login page does not list demo accounts", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Konta demonstracyjne" })).toHaveCount(0);
  });
});
