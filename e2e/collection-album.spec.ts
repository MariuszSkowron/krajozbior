import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";
import { expectScrollKept } from "./scroll-support";

// E12-4: the collection page as an album: header, state filter (works without JavaScript),
// grid of cards (a card is a plain link to the place; the selected-place card is gone, D-49). Needs a
// migrated, seeded database like the other specs that sign in; without it the spec is skipped.
// The cleanup deletes rows of the demo explorers straight in the database, so it runs only
// against the disposable E2E database (parseE2eAdminDatabaseUrl).
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const COLLECTION = `/collections/${DEMO_SLUG}`;
const EXPLORER = "user@demo.krajozbior.local";
const THEME_COOKIE = "krajozbior-theme";

async function expectNoAccessibilityViolations(page: Page) {
  // The entrance of a section dims the content; axe counts the contrast only after it ends.
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

async function inBothThemes(page: Page, check: () => Promise<void>) {
  for (const theme of ["dark", "light"]) {
    await page
      .context()
      .addCookies([{ name: THEME_COOKIE, value: theme, url: "http://127.0.0.1" }]);
    await page.reload();
    await waitForHydration(page);
    await expect(page.locator("html")).toHaveClass(new RegExp(`theme-${theme}`));
    await check();
  }
}

async function signedInPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/login");

  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(email);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);

  return page;
}

async function adminQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

async function cleanUp() {
  await adminQuery(
    `delete from public.visits where user_id in (select id from auth.users where email = any($1::text[]))`,
    [[EXPLORER]],
  );
  await adminQuery(
    `delete from public.saved_collections where user_id in (select id from auth.users where email = any($1::text[]))`,
    [[EXPLORER]],
  );
}

// A visit from the past of the explorer in the named place of the demo collection.
async function visitPast(placeName: string) {
  await adminQuery(
    `insert into public.visits (user_id, place_id, kind, date_precision)
     select u.id, p.id, 'past', 'unknown'
       from auth.users u, public.places p
      where u.email = $1 and p.name = $2`,
    [EXPLORER, placeName],
  );
}

const card = (page: Page, name: RegExp) =>
  page.getByRole("main").getByRole("list").getByRole("link", { name });

test.describe("the collection as an album", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("a guest sees the header of the album and no filter", async ({ page }) => {
    await page.goto(COLLECTION);

    await expect(page.getByText(/kolekcja · pomorskie/i)).toBeVisible();
    await expect(page.getByText("Kurator: Gmina A (demo)")).toBeVisible();
    await expect(page.getByText(/^3 miejsca · aktualizacja \d{2}\.\d{2}\.\d{4}$/)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Filtr miejsc" })).toHaveCount(0);
    await expect(card(page, /./)).toHaveCount(3);
  });

  test("a card is a link to the page of the place, on a desktop and on a phone, and there is no card of the chosen place", async ({
    page,
  }) => {
    await page.goto(COLLECTION);
    await waitForHydration(page);
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await expect(page.getByText("Wybrane miejsce")).toHaveCount(0);

    await card(page, /Most Tczewski/).click();
    await expect(page).toHaveURL(/\/places\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Most Tczewski" })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(COLLECTION);
    await waitForHydration(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
    await card(page, /Most Tczewski/).click();
    await expect(page).toHaveURL(/\/places\/[0-9a-f-]{36}$/);
  });

  test("without JavaScript a card is a link to the page of the place", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto(COLLECTION);

    const href = (await card(page, /Most Tczewski/).getAttribute("href")) ?? "";

    expect(href).toMatch(/^\/places\/[0-9a-f-]{36}$/);

    await card(page, /Most Tczewski/).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await context.close();
  });

  test("an old address with a chosen place gives the plain collection, without an error", async ({
    page,
  }) => {
    for (const value of ["11111111-1111-4111-8111-111111111111", "nie-uuid"]) {
      const response = await page.goto(`${COLLECTION}?miejsce=${value}`);

      expect(response?.status()).toBe(200);
      await expect(page.getByText("Wybrane miejsce")).toHaveCount(0);
      await expect(card(page, /./)).toHaveCount(3);
    }
  });

  test("an explorer: the filter with counts works without JavaScript and an unknown value shows everything", async ({
    browser,
  }) => {
    const signedIn = await signedInPage(browser, EXPLORER);
    const state = await signedIn.context().storageState();

    await signedIn.context().close();
    await visitPast("Most Tczewski");

    const context = await browser.newContext({ javaScriptEnabled: false, storageState: state });
    const page = await context.newPage();
    const nav = page.getByRole("navigation", { name: "Filtr miejsc" });

    await page.goto(COLLECTION);
    await expect(nav.getByRole("link", { name: "Wszystkie (3)" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Odwiedzone (1)" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Do odwiedzenia (2)" })).toBeVisible();
    await expect(card(page, /./)).toHaveCount(3);

    await nav.getByRole("link", { name: "Odwiedzone (1)" }).click();
    await expect(page).toHaveURL(/\?stan=odwiedzone$/);
    await expect(nav.getByRole("link", { name: "Odwiedzone (1)" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(card(page, /./)).toHaveCount(1);
    await expect(card(page, /Most Tczewski/)).toContainText("Z przeszłości");

    await nav.getByRole("link", { name: "Do odwiedzenia (2)" }).click();
    await expect(page).toHaveURL(/\?stan=do-odwiedzenia$/);
    await expect(card(page, /./)).toHaveCount(2);
    await expect(card(page, /Most Tczewski/)).toHaveCount(0);
    // The numbers of the places stay the numbers in the collection.
    await expect(card(page, /Zamek w Gniewie/)).toContainText("2.");

    await page.goto(`${COLLECTION}?stan=cokolwiek`);
    await expect(nav.getByRole("link", { name: "Wszystkie (3)" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(card(page, /./)).toHaveCount(3);
    await context.close();
  });

  test("an explorer: choosing places from the past works under a filter and the counts follow", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER);

    await page.goto(`${COLLECTION}?stan=do-odwiedzenia`);
    await waitForHydration(page);
    await page.getByRole("button", { name: "Zaznacz odwiedzone" }).click();
    await page.getByRole("checkbox", { name: /Most Tczewski/ }).check();
    await page.getByRole("button", { name: "Zapisz wizyty z przeszłości" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Zapisano 1 wizytę" })).toBeVisible();
    await expect(page).toHaveURL(/\?stan=do-odwiedzenia$/);
    await expect(page.getByRole("link", { name: "Odwiedzone (1)" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Do odwiedzenia (2)" })).toBeVisible();
    await page.context().close();
  });

  test("an explorer: a click on a state filter does not scroll the page (scrollY is the same before and after)", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER);

    await visitPast("Most Tczewski");
    // A low window, so that the page is longer than the screen and the filter can be scrolled to.
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.goto(COLLECTION);
    await waitForHydration(page);

    const nav = page.getByRole("navigation", { name: "Filtr miejsc" });

    await nav.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 120));

    const before = await page.evaluate(() => window.scrollY);

    expect(before).toBeGreaterThan(0);
    await nav.getByRole("link", { name: "Odwiedzone (1)" }).click();
    await expect(page).toHaveURL(/\?stan=odwiedzone$/);
    await expect(card(page, /./)).toHaveCount(1);
    // Let a possible scroll to the top happen before the check.
    await page.waitForTimeout(300);
    await expectScrollKept(page, nav, before);

    await nav.getByRole("link", { name: "Do odwiedzenia (2)" }).click();
    await expect(page).toHaveURL(/\?stan=do-odwiedzenia$/);
    await expect(card(page, /./)).toHaveCount(2);
    await page.waitForTimeout(300);
    await expectScrollKept(page, nav, before);
    await page.context().close();
  });

  test("accessibility: the album, as a guest and as an explorer, in both themes", async ({
    browser,
    page,
  }) => {
    await page.goto(COLLECTION);
    await waitForHydration(page);
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));

    const explorer = await signedInPage(browser, EXPLORER);

    await visitPast("Most Tczewski");
    await explorer.goto(`${COLLECTION}?stan=do-odwiedzenia`);
    await waitForHydration(explorer);
    await inBothThemes(explorer, () => expectNoAccessibilityViolations(explorer));
    await explorer.context().close();
  });
});
