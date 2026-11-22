import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// E12-S4: "Moje kolekcje": the filter by the state of progress (?stan=) and the mark "Nowa w
// okolicy" (read from the position only after a click, counted in the browser). Needs a migrated,
// seeded database like the other specs that sign in; without it the spec is skipped. The saved
// collection and the visits are written straight in the disposable E2E database, and the cleanup
// removes those of the demo explorer before and after each test.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const EXPLORER = "user@demo.krajozbior.local";
const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const DEMO_TITLE = "Mosty i zamki nad Wisłą (demo)";
const THEME_COOKIE = "krajozbior-theme";
// About 2 km from the centre of the demo places; a distant point for the negative case.
const NEAR = { latitude: 54.00123, longitude: 18.90456, accuracy: 25 };
const FAR = { latitude: 50.04132, longitude: 21.99901, accuracy: 25 };

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

async function signedInPage(
  browser: Browser,
  options: { position?: typeof NEAR; width?: number } = {},
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 390, height: 800 },
    ...(options.position === undefined
      ? {}
      : { geolocation: options.position, permissions: ["geolocation"] }),
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

test.describe("Moje kolekcje: filtr postępu i „Nowa w okolicy”", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("the filter by the state of progress shows the collection only in the matching state, and an unknown value shows all", async ({
    browser,
  }) => {
    await saveDemoCollection();

    const page = await signedInPage(browser);
    const choose = async (label: string) => {
      await page.getByLabel("Stan postępu").selectOption({ label });
      await page.getByRole("button", { name: "Pokaż", exact: true }).click();
    };
    // A plain string matches a substring of the name (a regular expression would read "(demo)" as a group).
    const card = () => list(page).getByRole("link", { name: DEMO_TITLE });

    await page.goto("/my/collections");
    await expect(card()).toBeVisible();
    await expect(page.getByLabel("Stan postępu")).toHaveValue("wszystkie");

    // Nothing visited yet: "Nierozpoczęte" only.
    await choose("W trakcie");
    await expect(page).toHaveURL(/\/my\/collections\?stan=w-trakcie$/);
    await expect(page.getByText("Żadna zapisana kolekcja nie ma stanu „W trakcie”.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Zapisane kolekcje (0 z 1)" })).toBeVisible();
    await expect(page.getByLabel("Stan postępu")).toHaveValue("w-trakcie");
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));

    await choose("Ukończone");
    await expect(page.getByText("Żadna zapisana kolekcja nie ma stanu „Ukończone”.")).toBeVisible();

    await choose("Nierozpoczęte");
    await expect(card()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Zapisane kolekcje (1 z 1)" })).toBeVisible();

    // One of three places visited: now "W trakcie".
    await visitFirstPlace();
    await page.goto("/my/collections?stan=nierozpoczete");
    await expect(
      page.getByText("Żadna zapisana kolekcja nie ma stanu „Nierozpoczęte”."),
    ).toBeVisible();
    await page.getByRole("link", { name: "Pokaż wszystkie" }).click();
    await expect(page).toHaveURL(/\/my\/collections$/);
    await expect(card()).toBeVisible();

    await choose("W trakcie");
    await expect(card()).toBeVisible();
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));

    await page.goto("/my/collections?stan=cokolwiek");
    await expect(card()).toBeVisible();
    await expect(page.getByLabel("Stan postępu")).toHaveValue("wszystkie");

    await page.context().close();
  });

  test("the mark 'Nowa w okolicy' appears only after a click and only near the collection", async ({
    browser,
  }) => {
    await saveDemoCollection();

    const page = await signedInPage(browser, { position: NEAR });

    await page.goto("/my/collections");

    const card = list(page).getByRole("link", { name: DEMO_TITLE });

    await expect(card).toBeVisible();
    await expect(list(page).getByText("Nowa w okolicy", { exact: true })).toHaveCount(0);

    await list(page).getByRole("button", { name: "Pokaż nowe w okolicy" }).click();
    await expect(list(page).getByText("Nowa w okolicy", { exact: true })).toBeVisible();
    await expect(
      list(page).getByRole("status").filter({ hasText: "Jedna z Twoich kolekcji" }),
    ).toBeVisible();
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));

    // The position stays in the browser: not in the address, not in the storage.
    expect(page.url()).not.toMatch(/54\.|18\.9/);
    // (The app itself keeps the e-mail of the sign-in form in the session storage, so the check
    // is for the coordinates, not for an empty storage.)
    const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));

    expect(storage).not.toMatch(/54\.0|18\.9|latitude|longitude/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);

    await page.context().close();

    // Far away (a new browser, because the position may be reused for ten minutes) the same
    // collection is not new in the neighbourhood.
    const far = await signedInPage(browser, { position: FAR });

    await far.goto("/my/collections");
    await expect(list(far).getByRole("link", { name: DEMO_TITLE })).toBeVisible();
    await list(far).getByRole("button", { name: "Pokaż nowe w okolicy" }).click();
    await expect(
      list(far)
        .getByRole("status")
        .filter({ hasText: "Żadna z Twoich kolekcji nie jest nowa w okolicy." }),
    ).toBeVisible();
    await expect(list(far).getByText("Nowa w okolicy", { exact: true })).toHaveCount(0);

    await far.context().close();
  });
});
