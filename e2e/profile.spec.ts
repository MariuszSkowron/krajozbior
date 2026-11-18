import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";

// E9-1: the "Profil" screen and logging out. The profile shows only entries that
// lead to existing screens, "Wyloguj" ends the session and every private screen
// then refuses the guest, also after "back". Uses the demo explorer; needs a
// migrated, seeded database like the other specs that sign in; without it the
// spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const EXPLORER = "user@demo.krajozbior.local";
const PRIVATE_PATHS = ["/my", "/my/collections", "/my/want-to-see"] as const;

async function expectNoAccessibilityViolations(page: Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  await page.addScriptTag({ content: axe.source });

  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run();

    return result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    }));
  });

  expect(violations).toEqual([]);
}

async function signedInPage(browser: Browser, width = 390): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await context.newPage();

  await page.goto("/login");

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(EXPLORER);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);

  return page;
}

test.describe("profile and logout", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test("the profile shows the role, links to existing screens only and fits a phone", async ({
    browser,
  }) => {
    const page = await signedInPage(browser);
    const main = page.getByRole("main");

    await expect(page).toHaveTitle("Profil — Krajozbiór");
    await expect(main.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();
    await expect(main).toContainText("Twoja rola: Użytkownik");
    await expect(main.getByRole("link")).toHaveText(["Moje kolekcje", "Chcę zobaczyć"]);
    await expect(main.getByRole("button", { name: "Wyloguj" })).toBeVisible();
    // No dead entries: Settings and contact arrive with their screens.
    await expect(main).not.toContainText("Ustawienia");
    await expect(main).not.toContainText("Napisz do nas");

    // The bottom bar marks the profile as the current item.
    await expect(page.locator('nav[aria-label="Główna"] a[aria-current="page"]')).toHaveText(
      "Profil",
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    for (const link of await main.getByRole("link").all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }

    await expectNoAccessibilityViolations(page);

    await page
      .context()
      .addCookies([{ name: "krajozbior-theme", value: "light", url: "http://127.0.0.1" }]);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/theme-light/);
    await expectNoAccessibilityViolations(page);

    await page.context().close();
  });

  test("the bottom bar item leads to the profile", async ({ browser }) => {
    const page = await signedInPage(browser);

    await page.goto("/my/collections");
    await page.locator('nav[aria-label="Główna"]').getByRole("link", { name: "Profil" }).click();
    await expect(page).toHaveURL(/\/my$/);
    await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();

    await page.context().close();
  });

  test("logging out ends the session on every private screen and after going back", async ({
    browser,
  }) => {
    const page = await signedInPage(browser);

    await page.getByRole("main").getByRole("button", { name: "Wyloguj" }).click();
    await expect(page).toHaveURL(/\/\?wylogowano=1$/);

    // Real "back": the previous history entry is the profile the user just left.
    // The page is sent with `Cache-Control: private, no-store` (src/proxy.ts), so
    // the browser neither reuses it from the HTTP cache nor restores it from the
    // back/forward cache; the request reaches the server and the guest is sent to
    // the login screen.
    await page.goBack();
    await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent("/my")}`);
    await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toHaveCount(0);

    expect((await page.request.get("/api/me")).status()).toBe(401);

    for (const path of PRIVATE_PATHS) {
      await page.goto(path);
      await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent(path)}`);
      await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toHaveCount(0);
    }

    await page.context().close();
  });
});
