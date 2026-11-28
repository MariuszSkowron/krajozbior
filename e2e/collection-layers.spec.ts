import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// Druga warstwa kolekcji: kraina i dwie mniejsze kolekcje z fikstury w bazie. Gość przechodzi
// z krainy do kolekcji tematycznej i z powrotem; odkrywca po jednej wizycie w miejscu wspólnym
// widzi wzrost postępu w krainie i w kolekcji tematycznej (R-15). Wymaga bazy po migracjach
// i seedzie (konta demo), jak inne scenariusze z logowaniem; bez niej scenariusze są pomijane.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const TAG = "(e2e-layers)";
const LAND = `Kraina warstw ${TAG}`;
const THEME_A = `Temat warstw A ${TAG}`;
const THEME_B = `Temat warstw B ${TAG}`;
const CURATOR = "curator-a@demo.krajozbior.local";
const EXPLORER = "user@demo.krajozbior.local";
// Miejsce wspólne krainy i tematu A, wizyta w nim jest potwierdzana na miejscu.
const SHARED_PLACE = "Miejsce wspólne warstw";
const SHARED_POSITION = { latitude: 53.7784, longitude: 20.4801 };

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
  const like = `%${TAG}`;

  await adminQuery(
    `delete from public.visits where place_id in (select id from public.places where name like $1)`,
    [like],
  );
  await adminQuery(
    `delete from public.collection_places where collection_id in (select id from public.collections where title like $1)`,
    [like],
  );
  await adminQuery(`delete from public.collections where title like $1`, [like]);
  await adminQuery(`delete from public.places where name like $1`, [like]);
}

// Kraina ma 4 miejsca; temat A ma 2 z nich (wszystkie jego miejsca leżą w krainie), temat B ma 1
// miejsce w krainie i 1 poza nią (linia „leżą w krainie”).
async function createFixtures() {
  const [{ organization_id: organizationId }] = await adminQuery<{ organization_id: string }>(
    `select m.organization_id from public.organization_members m
       join auth.users u on u.id = m.user_id where u.email = $1 limit 1`,
    [CURATOR],
  );
  const collection = async (title: string, kind: "land" | "theme") =>
    (
      await adminQuery<{ id: string }>(
        `insert into public.collections (slug, organization_id, title, summary, region, status, kind)
         values ($1, $2, $3, '', 'warminsko_mazurskie', 'published', $4) returning id`,
        [`e2e-layers-${Math.random().toString(36).slice(2, 10)}`, organizationId, title, kind],
      )
    )[0]!.id;
  const place = async (
    name: string,
    collections: readonly string[],
    position = { latitude: 53.8, longitude: 20.5 },
  ) => {
    const [{ id }] = await adminQuery<{ id: string }>(
      `insert into public.places (organization_id, name, address, latitude, longitude)
       values ($1, $2, 'Olsztyn', $3, $4) returning id`,
      [organizationId, `${name} ${TAG}`, position.latitude, position.longitude],
    );

    for (const collectionId of collections) {
      await adminQuery(
        `insert into public.collection_places (collection_id, place_id, organization_id, position)
         values ($1, $2, $3, (select count(*) + 1 from public.collection_places where collection_id = $1))`,
        [collectionId, id, organizationId],
      );
    }
  };

  const land = await collection(LAND, "land");
  const themeA = await collection(THEME_A, "theme");
  const themeB = await collection(THEME_B, "theme");

  await place(SHARED_PLACE, [land, themeA], SHARED_POSITION);
  await place("Drugie miejsce tematu A", [land, themeA]);
  await place("Wspólne miejsce tematu B", [land, themeB]);
  await place("Tylko w krainie", [land]);
  await place("Tylko w temacie B", [themeB]);
}

async function signedInPage(page: Page) {
  await page.goto("/login");
  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(EXPLORER);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(my)?$/);
}

const landLink = (page: Page) => page.getByRole("link", { name: LAND, exact: true });

test.describe("two layers of collections: a land and its theme collections", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(async () => {
    await cleanUp();
    await createFixtures();
  });
  test.afterEach(cleanUp);

  test("a guest goes from the land to a theme collection and back", async ({ page }) => {
    await page.goto("/search");

    await page.getByRole("link", { name: LAND }).click();
    await expect(page.getByRole("heading", { level: 1, name: LAND })).toBeVisible();

    const section = page.getByRole("region", { name: "Kolekcje w tej krainie" });

    await expect(section).toBeVisible();
    // Temat A ma w krainie 2 miejsca, temat B 1: najpierw ten z większą liczbą.
    await expect(section.getByRole("link")).toHaveCount(2);
    await expect(section.getByRole("link").first()).toContainText(THEME_A);
    await expect(section.getByRole("link").first()).toContainText(
      "Wszystkie miejsca kolekcji leżą tu",
    );
    await expect(section.getByRole("link").nth(1)).toContainText("1 z 2 miejsc kolekcji leży tu");
    // Gość nie ma postępu na kartach.
    await expect(section.getByRole("progressbar")).toHaveCount(0);

    await section.getByRole("link").first().click();
    await expect(page.getByRole("heading", { level: 1, name: THEME_A })).toBeVisible();
    await expect(page.getByText("Część krainy:")).toBeVisible();

    await landLink(page).click();
    await expect(page.getByRole("heading", { level: 1, name: LAND })).toBeVisible();
  });

  test("a theme collection with a place outside the land lists the land instead of 'part of'", async ({
    page,
  }) => {
    await page.goto("/search");
    await page.getByRole("link", { name: THEME_B }).click();
    await expect(page.getByRole("heading", { level: 1, name: THEME_B })).toBeVisible();
    await expect(page.getByText("Miejsca z tej kolekcji leżą w krainie:")).toBeVisible();
    await expect(page.getByText("Część krainy:")).toHaveCount(0);
    await expect(landLink(page)).toBeVisible();
  });

  test("one visit counts in the land and in the theme collection (R-15), on a 320 px screen", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 700 },
      permissions: ["geolocation"],
      geolocation: { ...SHARED_POSITION, accuracy: 20 },
    });
    const page = await context.newPage();

    await signedInPage(page);

    await page.goto("/search");
    await page.getByRole("link", { name: LAND }).click();
    await expect(page.getByRole("heading", { level: 1, name: LAND })).toBeVisible();

    const cardProgress = page.getByRole("progressbar", { name: `Postęp w kolekcji ${THEME_A}` });
    const landProgress = page.getByRole("progressbar", { name: `Twój postęp w kolekcji ${LAND}` });

    await expect(cardProgress).toHaveAttribute("value", "0");
    await expect(landProgress).toHaveAttribute("value", "0");

    // Jedna wizyta w miejscu wspólnym.
    const landUrl = page.url();

    await page.getByRole("link", { name: SHARED_PLACE }).first().click();
    await waitForHydration(page);
    await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(page.getByText(`${SHARED_PLACE} ${TAG} jest w Twoim albumie.`)).toBeVisible();

    await page.goto(landUrl);
    await expect(cardProgress).toHaveAttribute("value", "1");
    await expect(cardProgress).toHaveAttribute("max", "2");
    await expect(landProgress).toHaveAttribute("value", "1");
    await expect(landProgress).toHaveAttribute("max", "4");

    // Karty i sekcja mieszczą się na wąskim ekranie bez przewijania w poziomie.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);

    // Ta sama wizyta w kolekcji tematycznej.
    await page.getByRole("link", { name: THEME_A }).click();
    await expect(page.getByRole("heading", { level: 1, name: THEME_A })).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: `Twój postęp w kolekcji ${THEME_A}` }),
    ).toHaveAttribute("value", "1");

    const themeOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(themeOverflow).toBeLessThanOrEqual(0);

    await context.close();
  });
});
