import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { expectScrollKept } from "./scroll-support";

// E12-S4: "Moje kolekcje": the filter by the state of progress (?stan=), state buttons that are
// links (one click, no script needed, no jump to the top). The block "Pokaż nowe w okolicy" was
// removed from this screen (D-49). Needs a migrated, seeded database like the other specs that
// sign in; without it the spec is skipped. The saved collection and the visits are written
// straight in the disposable E2E database, and the cleanup removes those of the demo explorer
// before and after each test.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const EXPLORER = "user@demo.krajozbior.local";
const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const DEMO_TITLE = "Mosty i zamki nad Wisłą (demo)";
const THEME_COOKIE = "krajozbior-theme";

async function adminQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
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
  for (const table of ["visits", "saved_collections"]) {
    await adminQuery(
      `delete from public.${table} where user_id in (select id from auth.users where email = $1)`,
      [EXPLORER],
    );
  }
}

const saveDemoCollection = () =>
  adminQuery(
    `insert into public.saved_collections (user_id, collection_id)
     select u.id, c.id from auth.users u, public.collections c where u.email = $1 and c.slug = $2`,
    [EXPLORER, DEMO_SLUG],
  );

// A visit from the past in the first place of the demo collection (1 of 3 places visited).
const visitFirstPlace = () =>
  adminQuery(
    `insert into public.visits (user_id, place_id, kind, date_precision)
     select u.id, p.id, 'past', 'unknown'
       from auth.users u, public.places p
       join public.collection_places cp on cp.place_id = p.id
       join public.collections c on c.id = cp.collection_id
      where u.email = $1 and c.slug = $2 and cp.position = (
        select min(position) from public.collection_places where collection_id = c.id)`,
    [EXPLORER, DEMO_SLUG],
  );

async function signedInPage(browser: Browser, options: { width?: number } = {}): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 390, height: 800 },
  });
  const page = await context.newPage();

  await page.goto("/login");

  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(EXPLORER);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);

  return page;
}

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

// Checks the page in both themes without waiting for the network: the class of the theme is
// switched in place, and the check starts only once the page shows the expected state.
async function inBothThemes(page: Page, check: () => Promise<void>) {
  for (const theme of ["dark", "light"]) {
    await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url: page.url() }]);
    await page.evaluate((value) => {
      document.documentElement.classList.remove("theme-dark", "theme-light");
      document.documentElement.classList.add(`theme-${value}`);
    }, theme);
    await check();
  }
}

const list = (page: Page) => page.getByRole("region", { name: /^Zapisane kolekcje/ });

test.describe("Moje kolekcje: filtr postępu", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("the filter by the state of progress shows the collection only in the matching state, and an unknown value shows all", async ({
    browser,
  }) => {
    await saveDemoCollection();

    const page = await signedInPage(browser);
    const states = page.getByRole("navigation", { name: "Stan postępu" });
    // One click on a state button (a link with the state in the address), no second "Pokaż" click.
    const choose = async (label: string) => {
      await states.getByRole("link", { name: new RegExp(`^${label} \\(\\d+\\)$`) }).click();
    };
    const current = (label: string) =>
      states.getByRole("link", { name: new RegExp(`^${label} \\(\\d+\\)$`) });
    // A plain string matches a substring of the name (a regular expression would read "(demo)" as a group).
    const card = () => list(page).getByRole("link", { name: DEMO_TITLE });

    await page.goto("/my/collections");
    await expect(card()).toBeVisible();
    await expect(current("Wszystkie")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Pokaż", exact: true })).toHaveCount(0);

    // The filter does not jump to the top. A low window keeps the page longer than the screen even
    // when the filtered list is empty, so the browser cannot clamp scrollY to 0 by itself.
    await page.setViewportSize({ width: 390, height: 360 });
    await states.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 60));

    const scrollBefore = await page.evaluate(() => Math.round(window.scrollY));

    expect(scrollBefore).toBeGreaterThan(0);

    // Nothing visited yet: "Nierozpoczęte" only.
    await choose("W trakcie");
    await expect(page).toHaveURL(/\/my\/collections\?stan=w-trakcie$/);
    await expect(page.getByText("Nie masz kolekcji w trakcie.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Zapisane kolekcje (0 z 1)" })).toBeVisible();
    await expect(current("W trakcie")).toHaveAttribute("aria-current", "page");
    // A shorter list may clamp scrollY to the new maximum, but never to the top.
    await page.waitForTimeout(300);
    await expectScrollKept(page, states, scrollBefore);
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));

    await choose("Ukończone");
    await expect(page.getByText("Nie masz jeszcze ukończonych kolekcji.")).toBeVisible();

    await choose("Nierozpoczęte");
    await expect(card()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Zapisane kolekcje (1 z 1)" })).toBeVisible();

    // One of three places visited: now "W trakcie".
    await visitFirstPlace();
    await page.goto("/my/collections?stan=nierozpoczete");
    await expect(page.getByText("Każdą zapisaną kolekcję masz już zaczętą.")).toBeVisible();
    await page.getByRole("link", { name: "Pokaż wszystkie" }).click();
    await expect(page).toHaveURL(/\/my\/collections$/);
    await expect(card()).toBeVisible();

    await choose("W trakcie");
    await expect(card()).toBeVisible();
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));

    await page.goto("/my/collections?stan=cokolwiek");
    await expect(card()).toBeVisible();
    await expect(current("Wszystkie")).toHaveAttribute("aria-current", "page");

    await page.context().close();
  });

  for (const width of [1280, 1440]) {
    test(`on ${width} px the content is as wide as on the home page and the cards use 3 columns`, async ({
      browser,
    }) => {
      await saveDemoCollection();

      const page = await signedInPage(browser, { width });
      const contentWidth = () =>
        page.evaluate(
          () => document.querySelector("main > :first-child")?.getBoundingClientRect().width ?? 0,
        );

      await page.goto("/");
      await expect(page.getByRole("main")).toBeVisible();

      const homeWidth = await contentWidth();

      await page.goto("/my/collections");
      await expect(list(page).getByRole("link", { name: DEMO_TITLE })).toBeVisible();
      expect(await contentWidth()).toBe(homeWidth);

      const columns = await page.evaluate(
        () =>
          getComputedStyle(
            document.querySelector('section[aria-labelledby="zapisane"] ul')!,
          ).gridTemplateColumns.split(" ").length,
      );

      expect(columns).toBeGreaterThanOrEqual(3);
      await page.context().close();
    });
  }

  test("the block 'Pokaż nowe w okolicy' is gone from the screen", async ({ browser }) => {
    await saveDemoCollection();

    const page = await signedInPage(browser);

    await page.goto("/my/collections");
    await expect(list(page).getByRole("link", { name: DEMO_TITLE })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pokaż nowe w okolicy" })).toHaveCount(0);
    await expect(page.getByText("Nowa w okolicy", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Zapisane kolekcje i Twój postęp w nich.")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);

    await page.context().close();
  });
});
