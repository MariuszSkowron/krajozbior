import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// E12-4: the collection page as an album: header, state filter (works without JavaScript),
// grid of cards and the panel of the chosen place (desktop only, no new document). Needs a
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

const panelHeading = (page: Page) => page.locator("#panel-miejsca");

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

  test("desktop: a click on a card opens the panel without a new document; time to the panel is measured", async ({
    page,
  }) => {
    await page.goto(COLLECTION);
    await waitForHydration(page);
    await expect(panelHeading(page)).toHaveText("Wybrane miejsce");

    // The marker lives in the document: a full reload would remove it. The click time and the
    // moment the panel heading shows the name come from the page itself (no protocol delay).
    await page.evaluate(() => {
      const w = window as unknown as {
        __document: boolean;
        __t: { click?: number; panel?: number };
      };

      w.__document = true;
      w.__t = {};
      document.addEventListener("click", () => (w.__t.click = performance.now()), {
        capture: true,
      });
      new MutationObserver(() => {
        if (document.getElementById("panel-miejsca")?.textContent === "Most Tczewski") {
          w.__t.panel ??= performance.now();
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    const bridge = card(page, /Most Tczewski/);

    await bridge.click();
    await expect(panelHeading(page)).toHaveText("Most Tczewski");
    await expect(page).toHaveURL(/\?miejsce=[0-9a-f-]{36}$/);
    await expect(bridge).toHaveAttribute("aria-current", "true");
    // Same document, the focus stays on the card, the page is not scrolled to the top.
    expect(
      await page.evaluate(() => (window as unknown as { __document?: boolean }).__document),
    ).toBe(true);
    await expect(bridge).toBeFocused();

    const times = await page.evaluate(
      () => (window as unknown as { __t: { click: number; panel: number } }).__t,
    );
    const elapsed = Math.round(times.panel - times.click);

    console.log(`[e12-4] czas od kliknięcia do panelu: ${elapsed} ms (próg 300 ms)`);
    test.info().annotations.push({ type: "czas do panelu", description: `${elapsed} ms` });
    expect(elapsed).toBeLessThan(1500);

    const aside = page.getByRole("complementary");

    await expect(aside.getByText("Tczew", { exact: true })).toBeVisible();
    await expect(aside.getByRole("link", { name: "Otwórz stronę miejsca" })).toHaveAttribute(
      "href",
      /\/places\/[0-9a-f-]{36}$/,
    );
    // A guest has no visits and no list.
    await expect(aside.getByRole("button")).toHaveCount(0);

    // Another card changes the panel in the same document.
    await card(page, /Zamek w Gniewie/).click();
    await expect(panelHeading(page)).toHaveText("Zamek w Gniewie");
    expect(
      await page.evaluate(() => (window as unknown as { __document?: boolean }).__document),
    ).toBe(true);
  });

  test("a click with Ctrl and the link of the panel still lead to the page of the place", async ({
    page,
    context,
  }) => {
    await page.goto(COLLECTION);
    await waitForHydration(page);

    const opened = context.waitForEvent("page");

    await card(page, /Most Tczewski/).click({ modifiers: ["Control"] });
    await expect((await opened).url()).toMatch(/\/places\/[0-9a-f-]{36}$/);
    await expect(panelHeading(page)).toHaveText("Wybrane miejsce");

    await card(page, /Most Tczewski/).click();
    await page.getByRole("link", { name: "Otwórz stronę miejsca" }).click();
    await expect(page).toHaveURL(/\/places\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Most Tczewski" })).toBeVisible();
  });

  test("phone: a card leads to the page of the place and the panel is not shown", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(COLLECTION);
    await waitForHydration(page);
    await expect(page.getByRole("complementary")).toBeHidden();

    await card(page, /Most Tczewski/).click();
    await expect(page).toHaveURL(/\/places\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Most Tczewski" })).toBeVisible();

    // A shared link with a chosen place gives no panel on a phone either.
    const placeId = page.url().split("/").pop();

    await page.goto(`${COLLECTION}?miejsce=${placeId}`);
    await expect(page.getByRole("complementary")).toBeHidden();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("without JavaScript a card is a link to the page of the place, and the address can still choose the place", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto(COLLECTION);

    const href = (await card(page, /Most Tczewski/).getAttribute("href")) ?? "";

    expect(href).toMatch(/^\/places\/[0-9a-f-]{36}$/);

    await page.goto(`${COLLECTION}?miejsce=${href.split("/").pop()}`);
    await expect(panelHeading(page)).toHaveText("Most Tczewski");
    await expect(card(page, /Most Tczewski/)).toHaveAttribute("aria-current", "true");

    await card(page, /Most Tczewski/).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await context.close();
  });

  test("a place that is not in the collection, and a bad value, give no panel and no error", async ({
    page,
  }) => {
    for (const value of ["11111111-1111-4111-8111-111111111111", "nie-uuid"]) {
      const response = await page.goto(`${COLLECTION}?miejsce=${value}`);

      expect(response?.status()).toBe(200);
      await expect(panelHeading(page)).toHaveText("Wybrane miejsce");
      await expect(page.getByRole("link", { name: "Otwórz stronę miejsca" })).toHaveCount(0);
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

  test("an explorer: the panel shows the state of the visit and the list button", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER);

    await visitPast("Most Tczewski");
    await page.goto(COLLECTION);
    await waitForHydration(page);

    const aside = page.getByRole("complementary");

    await card(page, /Most Tczewski/).click();
    await expect(panelHeading(page)).toHaveText("Most Tczewski");
    await expect(aside.getByText("Z przeszłości", { exact: true })).toBeVisible();
    await expect(aside.getByRole("button", { name: "Chcę zobaczyć", exact: true })).toBeVisible();

    await card(page, /Zamek w Gniewie/).click();
    await expect(panelHeading(page)).toHaveText("Zamek w Gniewie");
    await expect(aside.getByText("Do odwiedzenia", { exact: true })).toBeVisible();
    await page.context().close();
  });

  test("accessibility: the album with the panel, as a guest and as an explorer, in both themes", async ({
    browser,
    page,
  }) => {
    await page.goto(COLLECTION);
    await waitForHydration(page);
    await card(page, /Most Tczewski/).click();
    await expect(panelHeading(page)).toHaveText("Most Tczewski");
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));

    const explorer = await signedInPage(browser, EXPLORER);

    await visitPast("Most Tczewski");
    await explorer.goto(`${COLLECTION}?stan=do-odwiedzenia`);
    await waitForHydration(explorer);
    await card(explorer, /Zamek w Gniewie/).click();
    await expect(panelHeading(explorer)).toHaveText("Zamek w Gniewie");
    await inBothThemes(explorer, () => expectNoAccessibilityViolations(explorer));
    await explorer.context().close();
  });
});
