import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// E12-1: the home page of a guest and of a signed-in explorer. The sign-out messages and
// the phone layout need no database. The rest needs a migrated, seeded database like the
// other specs that sign in; without it that part is skipped. The cleanup deletes rows of
// the two demo accounts straight in the database, so it runs only against the disposable
// E2E database (parseE2eAdminDatabaseUrl).
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const DEMO_TITLE = "Mosty i zamki nad Wisłą (demo)";
const EXPLORER_A = "user@demo.krajozbior.local";
const EXPLORER_B = "user2@demo.krajozbior.local";
const THEME_COOKIE = "krajozbior-theme";

async function expectNoAccessibilityViolations(page: Page) {
  // Wejście sekcji przygasza treść; axe liczy kontrast dopiero po końcu animacji.
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
    await page.waitForLoadState("networkidle");
    await expect(page.locator("html")).toHaveClass(new RegExp(`theme-${theme}`));
    await check();
  }
}

// Every link and form of the page leads to a page that exists (200 after redirects).
async function expectEveryLinkWorks(page: Page) {
  const targets = await page.evaluate(() => {
    const hrefs = [...document.querySelectorAll("main a[href]")].map((a) => a.getAttribute("href"));
    const actions = [...document.querySelectorAll("main form[action]")].map((form) =>
      form.getAttribute("action"),
    );

    return [...hrefs, ...actions].filter((value): value is string => value !== null);
  });
  const internal = new Set(
    targets
      .filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target))
      .map((target) => new URL(target, page.url()))
      .map((url) => `${url.pathname}${url.search}`),
  );

  expect(internal.size).toBeGreaterThan(0);
  for (const target of internal) {
    const response = await page.request.get(target);

    expect(response.status(), `GET ${target}`).toBe(200);
  }
}

async function signedInPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/login");

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(email);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);

  return page;
}

async function adminQuery(sql: string, params: unknown[] = []) {
  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    await client.query(sql, params);
  } finally {
    await client.end();
  }
}

async function cleanUp() {
  const users = [[EXPLORER_A, EXPLORER_B]];

  await adminQuery(
    `delete from public.visits where user_id in (select id from auth.users where email = any($1::text[]))`,
    users,
  );
  await adminQuery(
    `delete from public.saved_collections where user_id in (select id from auth.users where email = any($1::text[]))`,
    users,
  );
}

test("a successful sign-out is confirmed in a status region", async ({ page }) => {
  await page.goto("/?wylogowano=1");

  await expect(page.getByRole("status").filter({ hasText: "Wylogowano." })).toBeVisible();
});

test("the guest does not get a sign-out button after a failed sign-out", async ({ page }) => {
  await page.goto("/?wylogowanie=blad");

  await expect(
    page.getByRole("status").filter({ hasText: "Nie udało się wylogować. Spróbuj ponownie." }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Wyloguj" })).toHaveCount(0);
});

test("the start page keeps its content inside the screen on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe("home page with the catalog", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("a guest sees the introduction and the collections to discover, and every link works", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Odkrywaj miejsca i zbieraj je w swoim albumie",
      }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Zaloguj się" })).toHaveAttribute(
      "href",
      "/login",
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "Kolekcje do odkrycia" }),
    ).toBeVisible();

    const card = page.getByRole("link", { name: new RegExp(DEMO_TITLE.replace(/[()]/g, "\\$&")) });

    await expect(card).toHaveAttribute("href", `/collections/${DEMO_SLUG}`);
    await expect(page.getByText("3 miejsca · ")).toBeVisible();
    // The personal sections are not for a guest.
    await expect(page.getByRole("heading", { name: "Twój album" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Ostatnio odwiedzone" })).toHaveCount(0);
    // E12-2: the search field and the link to all collections (every link is checked below).
    await expect(page.getByRole("search").getByRole("searchbox")).toBeVisible();
    await expect(page.getByRole("link", { name: "Wszystkie kolekcje" })).toHaveAttribute(
      "href",
      "/search",
    );

    await expectEveryLinkWorks(page);
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));
  });

  test("an explorer sees the album: the saved collection first with 1/3, the visit from the past, 1 discovered place; explorer B sees none of it", async ({
    browser,
  }) => {
    const a = await signedInPage(browser, EXPLORER_A);
    const b = await signedInPage(browser, EXPLORER_B);

    await a.goto("/");
    await expect(a.getByRole("heading", { level: 1, name: "Dzień dobry" })).toBeVisible();
    await expect(a.getByText("Nie masz jeszcze zapisanych kolekcji")).toBeVisible();
    await expect(a.getByText("Nie masz jeszcze wizyt")).toBeVisible();
    // The empty favourites lead to the list of all collections.
    await expect(a.getByRole("link", { name: "Przeglądaj wszystkie kolekcje" })).toHaveAttribute(
      "href",
      "/search",
    );

    // A visit from the past in one place, then the collection saved.
    await a.goto(`/collections/${DEMO_SLUG}`);
    await a.goto((await a.getByRole("link", { name: /Most Tczewski/ }).getAttribute("href")) ?? "");
    await a.waitForLoadState("networkidle");
    await a.getByRole("button", { name: "Byłem tu wcześniej" }).click();
    await a.getByRole("radio", { name: "Rok" }).check();
    await a.getByRole("textbox", { name: "Rok", exact: true }).fill("2018");
    await a.getByRole("button", { name: "Zapisz wizytę z przeszłości" }).click();
    await expect(a.getByText("Z przeszłości · 2018")).toBeVisible();
    await a.goto(`/collections/${DEMO_SLUG}`);
    await a.getByRole("button", { name: "Zapisz kolekcję" }).click();
    await expect(a.getByRole("button", { name: "Usuń z zapisanych" })).toBeVisible();

    await a.goto("/");
    await a.waitForLoadState("networkidle");

    const summary = a.getByRole("region", { name: "Twój album" });

    await expect(summary.locator("div", { hasText: "Odkryte miejsca" }).first()).toContainText("1");
    await expect(summary.locator("div", { hasText: "Zapisane kolekcje" }).first()).toContainText(
      "1",
    );

    const favorites = a.getByRole("region", { name: "Ulubione kolekcje" });

    await expect(favorites.getByRole("link", { name: /Mosty i zamki/ })).toContainText("1/3");
    await expect(favorites.getByRole("link", { name: "Wszystkie moje kolekcje" })).toHaveAttribute(
      "href",
      "/my/collections",
    );

    const visits = a.getByRole("region", { name: "Ostatnio odwiedzone" });

    await expect(visits.getByRole("link", { name: "Most Tczewski" })).toBeVisible();
    await expect(visits.getByText("z przeszłości")).toBeVisible();
    await expect(visits.getByText("2018")).toBeVisible();

    await expectEveryLinkWorks(a);
    await inBothThemes(a, () => expectNoAccessibilityViolations(a));

    // Explorer B has nothing of A's: empty favourites and visits, zeros.
    await b.goto("/");
    await expect(b.getByText("Nie masz jeszcze zapisanych kolekcji")).toBeVisible();
    await expect(b.getByText("Nie masz jeszcze wizyt")).toBeVisible();
    await expect(
      b
        .getByRole("region", { name: "Twój album" })
        .locator("div", { hasText: "Odkryte miejsca" })
        .first(),
    ).toContainText("0");

    await a.context().close();
    await b.context().close();
  });
});
