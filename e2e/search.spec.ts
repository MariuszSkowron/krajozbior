import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// E12-2: the public search `/search` and the search field of the home page. Needs a migrated,
// seeded database like the other specs that sign in; without it the spec is skipped. The fixtures
// (two published collections with Polish letters in their titles, one draft, three places) are
// written and removed straight in the database, so they exist only against the disposable
// E2E database (parseE2eAdminDatabaseUrl). Every row carries the tag below; cleanup deletes by it.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const TAG = "(e2e-search)";
const LODZ = `Łódź włókniarzy ${TAG}`;
const ZULAWY = `Żuławy ${TAG}`;
const DRAFT = `Szkic wieży ${TAG}`;
const SUDETY = `Sudety graniczne ${TAG}`;
const SUDETY_PLACE = `Szczyt sudecki ${TAG}`;
const TOWER = `Wieża ciśnień ${TAG}`;
const DRAFT_PLACE = `Wieża tylko w szkicu ${TAG}`;
const CURATOR = "curator-a@demo.krajozbior.local";
const THEME_COOKIE = "krajozbior-theme";

async function adminQuery<T = never>(sql: string, params: unknown[] = []): Promise<T[]> {
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
  const like = `%${TAG}`;

  await adminQuery(
    `delete from public.collection_places where collection_id in (select id from public.collections where title like $1)`,
    [like],
  );
  await adminQuery(`delete from public.collections where title like $1`, [like]);
  await adminQuery(`delete from public.places where name like $1`, [like]);
}

async function createFixtures() {
  const [{ organization_id: organizationId }] = await adminQuery<{ organization_id: string }>(
    `select m.organization_id from public.organization_members m
       join auth.users u on u.id = m.user_id where u.email = $1 limit 1`,
    [CURATOR],
  );
  const collection = async (
    title: string,
    region: string,
    status: string,
    extraRegions: readonly string[] = [],
  ) =>
    (
      await adminQuery<{ id: string }>(
        `insert into public.collections (slug, organization_id, title, summary, region, status, extra_regions)
         values ($1, $2, $3, '', $4, $5, $6::text[]) returning id`,
        [
          `e2e-search-${Math.random().toString(36).slice(2, 10)}`,
          organizationId,
          title,
          region,
          status,
          extraRegions,
        ],
      )
    )[0]!.id;
  const place = async (name: string, address: string, collectionId: string) => {
    const [{ id }] = await adminQuery<{ id: string }>(
      `insert into public.places (organization_id, name, address, latitude, longitude)
       values ($1, $2, $3, 51.76, 19.45) returning id`,
      [organizationId, name, address],
    );

    await adminQuery(
      `insert into public.collection_places (collection_id, place_id, organization_id, position)
       values ($1, $2, $3, 1)`,
      [collectionId, id, organizationId],
    );
  };

  const lodz = await collection(LODZ, "lodzkie", "published");
  const zulawy = await collection(ZULAWY, "pomorskie", "published");
  const draft = await collection(DRAFT, "pomorskie", "draft");
  // A land on the border of two voivodeships: the main one and one extra (D-63).
  const sudety = await collection(SUDETY, "dolnoslaskie", "published", ["opolskie"]);

  await place(SUDETY_PLACE, "ul. Górska, Nowa Ruda", sudety);
  await place(TOWER, "ul. Żurawia 3, Tczew", zulawy);
  await place(`Fabryka Poznańskiego ${TAG}`, "ul. Ogrodowa, Łódź", lodz);
  await place(DRAFT_PLACE, "ul. Szkicowa", draft);
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

async function signedInPage(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/login");

  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(`${name}@demo.krajozbior.local`);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(
    name.startsWith("curator") ? /\/curator$/ : /^https?:\/\/[^/]+\/(my)?$/,
  );

  return page;
}

// Skipped as a whole without the database; the cleanup of the tagged rows runs before and after.
test.describe("search", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(async () => {
    await cleanUp();
    await createFixtures();
  });
  test.afterEach(cleanUp);

  test("finds collections and places by a phrase without Polish letters or capitals", async ({
    page,
  }) => {
    await page.goto("/search?q=lodz");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Znaleziono 1 kolekcję i 1 miejsce dla „lodz”",
    );
    await expect(
      page
        .getByRole("region", { name: "Kolekcje" })
        .getByRole("link", { name: new RegExp("Łódź włókniarzy") }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Miejsca" })
        .getByRole("link", { name: /Fabryka Poznańskiego/ }),
    ).toBeVisible();

    await page.goto("/search?q=%C5%BBU%C5%81AWY");
    await expect(page.getByRole("link", { name: new RegExp("Żuławy") })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("dla „ŻUŁAWY”");

    await page.goto("/search?q=WIEZA");
    const place = page
      .getByRole("region", { name: "Miejsca" })
      .getByRole("link", { name: /Wieża ciśnień/ });

    await expect(place).toBeVisible();
    await expect(place).toContainText(`Kolekcja: ${ZULAWY}`);
    expect((await page.request.get((await place.getAttribute("href"))!)).status()).toBe(200);
  });

  test("shows no draft and no place only in a draft, to a guest and to the curator who owns them", async ({
    browser,
    page,
  }) => {
    for (const phrase of ["szkic", "wieza"]) {
      await page.goto(`/search?q=${phrase}`);
      await expect(page.getByText(DRAFT)).toHaveCount(0);
      await expect(page.getByText(DRAFT_PLACE)).toHaveCount(0);
    }

    await page.goto("/search?q=szkic");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Nic nie znaleziono dla „szkic”",
    );

    const curator = await signedInPage(browser, "curator-a");

    await curator.goto("/curator");
    await expect(curator.getByText(DRAFT)).toBeVisible();
    for (const phrase of ["szkic", "wieza"]) {
      await curator.goto(`/search?q=${phrase}`);
      await expect(curator.getByText(DRAFT)).toHaveCount(0);
      await expect(curator.getByText(DRAFT_PLACE)).toHaveCount(0);
    }
    await curator.context().close();
  });

  test("says when nothing was found, and what is wrong with a phrase that is too short or too long", async ({
    page,
  }) => {
    await page.goto("/search?q=qqqzzzqqq");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Nic nie znaleziono dla „qqqzzzqqq”",
    );
    await page.getByRole("link", { name: "zobacz wszystkie kolekcje" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Wszystkie kolekcje" })).toBeVisible();

    await page.goto("/search?q=a");
    // The route announcer of Next.js is also an alert, so the page's own one is looked up in main.
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "Wpisz co najmniej 2 znaki.",
    );
    await expect(page.getByRole("heading", { level: 1, name: "Wszystkie kolekcje" })).toBeVisible();

    await page.goto(`/search?q=${"a".repeat(81)}`);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Wpisz najwyżej 80 znaków.");
  });

  test("lists all collections and filters them by region with the select of the form", async ({
    page,
  }) => {
    await page.goto("/search");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Wszystkie kolekcje" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Łódź włókniarzy/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Żuławy/ })).toBeVisible();

    await page.getByLabel("Województwo").selectOption("lodzkie");
    await page.getByRole("button", { name: "Szukaj" }).click();
    await expect(page).toHaveURL(/region=lodzkie/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kolekcje: łódzkie");
    await expect(page.getByRole("link", { name: /Łódź włókniarzy/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Żuławy/ })).toHaveCount(0);

    // A phrase with a region: the region of a collection can also be the phrase.
    await page.goto("/search?q=pomor");
    await expect(page.getByRole("link", { name: /Żuławy/ })).toBeVisible();
  });

  test("shows a collection of two voivodeships in the filter of each, with both names on the card", async ({
    page,
  }) => {
    for (const region of ["dolnoslaskie", "opolskie"]) {
      await page.goto(`/search?region=${region}`);
      await waitForHydration(page);

      const card = page.getByRole("link", { name: /Sudety graniczne/ });

      await expect(card).toBeVisible();
      // Nazwy są osobnymi elementami (kropka ukryta przed czytnikiem, przecinek tylko dla niego).
      await expect(card).toContainText("Dolnośląskie");
      await expect(card).toContainText("Opolskie");
    }

    await page.goto("/search?region=slaskie");
    await expect(page.getByRole("link", { name: /Sudety graniczne/ })).toHaveCount(0);

    // The phrase names the extra voivodeship: the collection is found without a filter, and the
    // collection page names both.
    await page.goto("/search?q=opol");
    await expect(page.getByRole("link", { name: /Sudety graniczne/ })).toBeVisible();
    await page.getByRole("link", { name: /Sudety graniczne/ }).click();
    await expect(page.getByText("Kolekcja · Dolnośląskie · Opolskie")).toBeVisible();
  });

  test("announces the number of results in a status region", async ({ page }) => {
    await page.goto("/search?q=lodz");
    await expect(
      page.getByRole("status").filter({ hasText: "Znaleziono 1 kolekcję i 1 miejsce." }),
    ).toHaveCount(1);
  });

  test("the field on the home page leads to the results, also without JavaScript", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    await waitForHydration(page);
    await page.getByRole("searchbox", { name: "Szukaj miejsc i kolekcji" }).fill("lodz");
    await page.getByRole("button", { name: "Szukaj" }).click();
    await expect(page).toHaveURL(/\/search\?q=lodz/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("dla „lodz”");

    const plain = await browser.newContext({ javaScriptEnabled: false });
    const noScript = await plain.newPage();

    await noScript.goto("/");
    await noScript.getByRole("searchbox", { name: "Szukaj miejsc i kolekcji" }).fill("zulawy");
    await noScript.getByRole("button", { name: "Szukaj" }).click();
    await expect(noScript).toHaveURL(/\/search\?q=zulawy/);
    await expect(noScript.getByRole("link", { name: /Żuławy/ })).toBeVisible();
    await plain.close();
  });

  test("fits a phone and has no accessibility violations in both themes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });

    for (const url of ["/search?q=lodz", "/search?q=qqqzzzqqq", "/search", "/search?q=a"]) {
      await page.goto(url);
      await waitForHydration(page);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow, url).toBeLessThanOrEqual(0);
      await inBothThemes(page, () => expectNoAccessibilityViolations(page));
    }
  });
});
