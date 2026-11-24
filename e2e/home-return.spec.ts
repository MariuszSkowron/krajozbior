import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";
import { waitForEntrance } from "./scroll-support";

// D-58 pkt 4 (paczka 6): powody do powrotu na Starcie. Gość widzi „Miejsce dnia”, „Nowe kolekcje”
// i „Aktualności i wydarzenia” (z demo aktualności seedu); odkrywca z zapisaną kolekcją w toku
// widzi też „Do odkrycia w Twoich kolekcjach”, a z wizytą w niezapisanej kolekcji zachętę do
// zapisu. Stany puste, oba motywy, telefon i komputer, axe. Wymaga zmigrowanej bazy z seedem;
// bez niej spec jest pomijany. Zdjęcie miejsca ma wiersz w bazie bez pliku (adres zdjęcia nie jest
// tu sprawdzany).
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const EXPLORER = "user@demo.krajozbior.local";
const THEME_COOKIE = "krajozbior-theme";

const adminClient = () =>
  new Client({ connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL) });

type Seeded = { collectionId: string; slug: string; title: string; placeIds: string[] };

let seeded: Seeded | null = null;

async function seed(client: Client): Promise<Seeded> {
  const org = await client.query<{ id: string }>(
    `select id from public.organizations where name = 'Gmina A (demo)'`,
  );
  const organizationId = org.rows[0]!.id;
  const suffix = randomUUID().slice(0, 8);
  const title = `Powody ${suffix}`;
  const slug = `powody-${suffix}`;
  const collection = await client.query<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, summary, region, status)
     values ($1, $2, $3, 'Trzy miejsca do sprawdzenia powodów do powrotu.', 'pomorskie', 'draft')
     returning id`,
    [slug, organizationId, title],
  );
  const collectionId = collection.rows[0]!.id;
  const placeIds: string[] = [];

  for (let index = 0; index < 3; index += 1) {
    const place = await client.query<{ id: string }>(
      `insert into public.places (organization_id, name, address, description, latitude, longitude)
       values ($1, $2, $3, 'Opis miejsca testowego. Drugie zdanie opisu.', 54.1, 18.7) returning id`,
      [organizationId, `Miejsce powodów ${index + 1} ${suffix}`, `Ulica ${index + 1}, Gdańsk`],
    );
    const placeId = place.rows[0]!.id;

    await client.query(
      `insert into public.collection_places (collection_id, place_id, organization_id, position)
       values ($1, $2, $3, $4)`,
      [collectionId, placeId, organizationId, index + 1],
    );
    placeIds.push(placeId);
  }

  await client.query(
    `insert into public.place_photos
       (organization_id, place_id, position, file_state, storage_key, width, height, alt_text,
        source_kind, title, author_text, source_url, license_code, license_url, license_label,
        rights_statement, commons_file)
     values ($1, $2, 1, 'ready', $3, 1600, 1067, 'Zamek testowy', 'commons_import', 'Zamek testowy',
             'Fikcyjny Autor', 'https://commons.wikimedia.org/wiki/File:Zamek_powody.jpg',
             'cc-by-sa-3.0', 'https://creativecommons.org/licenses/by-sa/3.0/pl/',
             'CC BY-SA 3.0 PL', 'commons-import/1', $4)`,
    [organizationId, placeIds[0], randomUUID(), `Zamek-powody-${suffix}.jpg`],
  );
  await client.query(
    `update public.collections set status = 'published', first_published_at = now() where id = $1`,
    [collectionId],
  );

  return { collectionId, slug, title, placeIds };
}

async function explorerData(setup: (client: Client, userId: string) => Promise<void>) {
  const client = adminClient();

  await client.connect();
  try {
    const user = await client.query<{ id: string }>(`select id from auth.users where email = $1`, [
      EXPLORER,
    ]);

    await setup(client, user.rows[0]!.id);
  } finally {
    await client.end();
  }
}

const clearExplorer = () =>
  explorerData(async (client, userId) => {
    await client.query(`delete from public.visits where user_id = $1`, [userId]);
    await client.query(`delete from public.saved_collections where user_id = $1`, [userId]);
  });

// Odkrywca z `visited` wizytami w kolekcji testowej; zapisaną kolekcję ma tylko z `save`.
const visitOf = (visited: number, save: boolean) =>
  explorerData(async (client, userId) => {
    if (save) {
      await client.query(
        `insert into public.saved_collections (user_id, collection_id) values ($1, $2)`,
        [userId, seeded!.collectionId],
      );
    }
    for (const placeId of seeded!.placeIds.slice(0, visited)) {
      await client.query(
        `insert into public.visits (user_id, place_id, kind, date_precision)
         values ($1, $2, 'past', 'unknown')`,
        [userId, placeId],
      );
    }
  });

async function signedInPage(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  await page.goto("/login");
  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(EXPLORER);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(my)?$/);

  return page;
}

async function expectNoAccessibilityViolations(page: Page) {
  await waitForEntrance(page);
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

const overflowOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const region = (page: Page, name: string) => page.getByRole("region", { name });

const SIZES = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
];

test.describe("home page: reasons to return", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeAll(async () => {
    const client = adminClient();

    await client.connect();
    try {
      seeded = await seed(client);
    } finally {
      await client.end();
    }
  });

  test.afterEach(clearExplorer);

  test.afterAll(async () => {
    if (seeded === null) {
      return;
    }

    const client = adminClient();

    await client.connect();
    try {
      await client.query("delete from public.place_photos where place_id = any($1::uuid[])", [
        seeded.placeIds,
      ]);
      await client.query("delete from public.collection_places where collection_id = $1", [
        seeded.collectionId,
      ]);
      await client.query("delete from public.collections where id = $1", [seeded.collectionId]);
      await client.query("delete from public.places where id = any($1::uuid[])", [seeded.placeIds]);
    } finally {
      await client.end();
    }
  });

  for (const size of SIZES) {
    test(`a guest sees the place of the day, the new collections and the news at ${size.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/");
      await waitForHydration(page);

      const day = region(page, "Miejsce dnia");

      await expect(day).toBeVisible();
      await expect(day.getByRole("link", { name: "Zobacz miejsce" })).toHaveAttribute(
        "href",
        /^\/places\/[0-9a-f-]{36}$/,
      );
      await expect(day.getByText(/^z kolekcji /)).toBeVisible();

      const fresh = region(page, "Nowe kolekcje");

      await expect(fresh.getByRole("link", { name: seeded!.title })).toHaveAttribute(
        "href",
        `/collections/${seeded!.slug}`,
      );
      await expect(
        fresh.getByText(/dodana \d{1,2}\.\d{2}\.\d{4} · 3 miejsca · /).first(),
      ).toBeVisible();
      // No link to "all new collections": there is no such view yet (search sorts by title).
      await expect(fresh.getByRole("link", { name: "Wszystkie nowe kolekcje" })).toHaveCount(0);

      const news = region(page, "Aktualności i wydarzenia");

      await expect(news).toBeVisible();
      await expect(news.getByRole("link", { name: "Wszystkie aktualności" })).toHaveAttribute(
        "href",
        "/news",
      );
      expect(await news.getByRole("listitem").count()).toBeLessThanOrEqual(3);

      // The personal sections are not for a guest.
      await expect(
        page.getByRole("heading", { name: "Do odkrycia w Twoich kolekcjach" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Masz już miejsca z tej kolekcji" }),
      ).toHaveCount(0);

      expect(await overflowOf(page)).toBeLessThanOrEqual(0);
      await inBothThemes(page, () => expectNoAccessibilityViolations(page));
    });
  }

  test("the place of the day is the same on every request of the day", async ({ page }) => {
    await page.goto("/");

    const href = () =>
      region(page, "Miejsce dnia")
        .getByRole("link", { name: "Zobacz miejsce" })
        .getAttribute("href");
    const first = await href();

    await page.reload();
    expect(await href()).toBe(first);
  });

  for (const size of SIZES) {
    test(`an explorer with a collection in progress sees what is left in it at ${size.name}`, async ({
      browser,
    }) => {
      await visitOf(1, true);

      const page = await signedInPage(browser, size);

      await page.goto("/");
      await waitForHydration(page);

      const left = region(page, "Do odkrycia w Twoich kolekcjach");
      const row = left.getByRole("listitem").filter({ hasText: seeded!.title });

      await expect(row.getByRole("link", { name: seeded!.title })).toHaveAttribute(
        "href",
        `/collections/${seeded!.slug}`,
      );
      await expect(row).toContainText("do odkrycia: 2");
      await expect(row).toContainText("Miejsce powodów 2");
      await expect(row).toContainText("Miejsce powodów 3");
      // The collection is saved, so there is no nudge to save it.
      await expect(
        page.getByRole("heading", { name: "Masz już miejsca z tej kolekcji" }),
      ).toHaveCount(0);

      expect(await overflowOf(page)).toBeLessThanOrEqual(0);
      await inBothThemes(page, () => expectNoAccessibilityViolations(page));
      await page.context().close();
    });
  }

  test("an explorer who completed every saved collection is asked to choose the next one", async ({
    browser,
  }) => {
    await visitOf(3, true);

    const page = await signedInPage(browser, SIZES[0]!);

    await page.goto("/");

    const left = region(page, "Do odkrycia w Twoich kolekcjach");

    await expect(
      left.getByText("Wszystkie zapisane kolekcje masz ukończone. Wybierz następną."),
    ).toBeVisible();
    await expect(left.getByRole("link", { name: "Zobacz kolekcje" })).toHaveAttribute(
      "href",
      "#do-odkrycia",
    );
    await expectNoAccessibilityViolations(page);
    await page.context().close();
  });

  for (const size of SIZES) {
    test(`an explorer with a visit in an unsaved collection is asked to save it at ${size.name}`, async ({
      browser,
    }) => {
      await visitOf(1, false);

      const page = await signedInPage(browser, size);

      await page.goto("/");
      await waitForHydration(page);

      const nudge = region(page, "Masz już miejsca z tej kolekcji");

      await expect(
        nudge.getByText(
          `Masz 1 z 3 miejsc kolekcji ${seeded!.title}. Zapisz ją, żeby widzieć postęp.`,
        ),
      ).toBeVisible();
      await expect(nudge.getByRole("link", { name: "Zobacz kolekcję" })).toHaveAttribute(
        "href",
        `/collections/${seeded!.slug}`,
      );
      // „Do odkrycia w Twoich kolekcjach” is absent: nothing is saved yet.
      await expect(
        page.getByRole("heading", { name: "Do odkrycia w Twoich kolekcjach" }),
      ).toHaveCount(0);

      expect(await overflowOf(page)).toBeLessThanOrEqual(0);
      await inBothThemes(page, () => expectNoAccessibilityViolations(page));

      await nudge.getByRole("button", { name: "Zapisz kolekcję" }).click();
      await expect(
        page.getByRole("heading", { name: "Masz już miejsca z tej kolekcji" }),
      ).toHaveCount(0);
      await expect(
        region(page, "Do odkrycia w Twoich kolekcjach").getByRole("link", { name: seeded!.title }),
      ).toBeVisible();
      await page.context().close();
    });
  }

  test("a new explorer sees neither the left-over section nor the nudge", async ({ browser }) => {
    const page = await signedInPage(browser, SIZES[0]!);

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Do odkrycia w Twoich kolekcjach" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Masz już miejsca z tej kolekcji" }),
    ).toHaveCount(0);
    // The public reasons stay.
    await expect(region(page, "Nowe kolekcje")).toBeVisible();
    await page.context().close();
  });
});
