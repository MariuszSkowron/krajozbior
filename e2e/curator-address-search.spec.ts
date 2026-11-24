import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// K-2: the curator finds a place by its address and the pin is set; the pin can still be moved.
// The geocoding answer is always replaced here (route of the app), so neither CI nor an agent
// talks to the live Nominatim service; the tiles are a local image like in
// `place-editor-map.spec.ts`. Needs a migrated, seeded database; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const TILE_HOST = "tile.openstreetmap.org";
const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const FOUND = [
  { label: "Dworcowa 1, Rumia, pomorskie", latitude: 54.5701, longitude: 18.3939 },
  { label: "Dworcowa 1, Gdynia, pomorskie", latitude: 54.5189, longitude: 18.5305 },
];
const createdCollectionIds: string[] = [];

async function removeCreatedData() {
  const collectionIds = createdCollectionIds.splice(0);

  if (collectionIds.length === 0) {
    return;
  }

  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    const { rows } = await client.query(
      "select place_id from public.collection_places where collection_id = any($1::uuid[])",
      [collectionIds],
    );

    await client.query(
      "delete from public.collection_places where collection_id = any($1::uuid[])",
      [collectionIds],
    );
    await client.query("delete from public.collections where id = any($1::uuid[])", [
      collectionIds,
    ]);
    await client.query("delete from public.places where id = any($1::uuid[])", [
      rows.map((row: { place_id: string }) => row.place_id),
    ]);
  } finally {
    await client.end();
  }
}

async function stubTiles(page: Page) {
  await page.route(`https://${TILE_HOST}/**`, (route) =>
    route.fulfill({ contentType: "image/png", body: TILE_PNG }),
  );
  await page.route(`https://*.${TILE_HOST}/**`, (route) => route.abort());
}

async function signInAsCurator(page: Page) {
  await page.goto("/login");
  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill("curator-a@demo.krajozbior.local");
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/curator$/);
}

async function openNewPlace(page: Page): Promise<string> {
  const response = await page.request.post("/api/curator/collections", {
    data: { title: `Szukanie adresu ${Date.now()}`, region: "pomorskie" },
  });

  expect(response.ok(), await response.text()).toBe(true);

  const id = String(((await response.json()) as { id: string }).id);

  createdCollectionIds.push(id);
  await page.goto(`/curator/collections/${id}/places/new`);
  await waitForHydration(page);

  return id;
}

test.describe("address search in the place editor", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.afterEach(removeCreatedData);

  test("an address sets the pin; the curator chooses among results and saves", async ({ page }) => {
    await stubTiles(page);

    const requests: string[] = [];

    await page.route("**/api/curator/geocode", async (route) => {
      requests.push(route.request().postData() ?? "");
      await route.fulfill({ json: { results: FOUND } });
    });
    await signInAsCurator(page);
    await openNewPlace(page);
    await page.getByLabel("Nazwa", { exact: true }).fill("Miejsce z adresu");

    await expect(page.getByTestId("pin-status")).toHaveText("Położenie nie jest jeszcze ustawione");
    await page.getByLabel("Znajdź miejsce po adresie").fill("Dworcowa 1");
    await page.getByRole("button", { name: "Szukaj", exact: true }).click();

    // Nothing is chosen for the curator: the results wait for a click.
    const results = page.getByRole("list", { name: "Wyniki wyszukiwania adresu" });

    await expect(results.getByRole("button")).toHaveCount(2);
    await expect(page.getByTestId("pin-status")).toHaveText("Położenie nie jest jeszcze ustawione");
    expect(requests).toEqual([JSON.stringify({ query: "Dworcowa 1" })]);

    await results.getByRole("button", { name: /Gdynia/ }).click();
    await expect(page.getByTestId("pin-status")).toHaveText("Pinezka: 54,5189, 18,5305");
    await expect(page.getByTestId("place-map")).toBeVisible();
    await expect(page.getByTestId("address-search-status")).toContainText("Ustawiono pinezkę");
    // An empty "Adres" takes the chosen label: the curator does not type the address twice.
    await expect(page.getByLabel("Adres", { exact: true })).toHaveValue(FOUND[1].label);

    // The pin can still be moved: "Ustaw pinezkę na środku mapy" takes the center of the map.
    await page.getByRole("button", { name: "Ustaw pinezkę na środku mapy" }).click();
    await expect(page.getByTestId("pin-status")).toContainText("Pinezka: 54,5");

    await page.screenshot({ path: ".ai/tmp/p4fix2/wyszukiwanie-adresu.png", fullPage: true });
    await page.getByRole("button", { name: "Dodaj miejsce do kolekcji" }).click();
    await expect(page).toHaveURL(/\/curator\/collections\/[0-9a-f-]+(\?.*)?$/);
    await expect(page.getByRole("link", { name: "Miejsce z adresu" })).toBeVisible();
  });

  test("a filled address is never overwritten by a chosen result", async ({ page }) => {
    await stubTiles(page);
    await page.route("**/api/curator/geocode", (route) =>
      route.fulfill({ json: { results: [FOUND[0]] } }),
    );
    await signInAsCurator(page);
    await openNewPlace(page);
    await page.getByLabel("Adres", { exact: true }).fill("ul. Dworcowa 1");
    await page.getByLabel("Znajdź miejsce po adresie").fill("Dworcowa 1, Rumia");
    await page.getByRole("button", { name: "Szukaj", exact: true }).click();
    await page
      .getByRole("list", { name: "Wyniki wyszukiwania adresu" })
      .getByRole("button")
      .click();

    await expect(page.getByLabel("Adres", { exact: true })).toHaveValue("ul. Dworcowa 1");
    await expect(page.getByTestId("address-search-status")).toContainText(
      "Pole „Adres” zostało bez zmian",
    );
  });

  test("Enter in the search field searches and does not send the form", async ({ page }) => {
    await stubTiles(page);
    await page.route("**/api/curator/geocode", (route) =>
      route.fulfill({ json: { results: [FOUND[0]] } }),
    );
    await signInAsCurator(page);
    await openNewPlace(page);
    await page.getByLabel("Znajdź miejsce po adresie").fill("Dworcowa 1, Rumia");
    await page.getByLabel("Znajdź miejsce po adresie").press("Enter");

    await expect(
      page.getByRole("list", { name: "Wyniki wyszukiwania adresu" }).getByRole("button"),
    ).toHaveCount(1);
    await expect(page).toHaveURL(/places\/new$/);
    await expect(page.locator("main [role=alert]")).toHaveCount(0);
  });

  test("no result, a refusal and a failure of the service are told with a way on", async ({
    page,
  }) => {
    await stubTiles(page);

    let answer: { status: number; json: unknown } = { status: 200, json: { results: [] } };

    await page.route("**/api/curator/geocode", (route) =>
      route.fulfill({ status: answer.status, json: answer.json }),
    );
    await signInAsCurator(page);
    await openNewPlace(page);

    const status = page.getByTestId("address-search-status");
    const search = async (text: string) => {
      await page.getByLabel("Znajdź miejsce po adresie").fill(text);
      await page.getByRole("button", { name: "Szukaj", exact: true }).click();
    };

    await search("zzzzzz");
    await expect(status).toContainText("Nic nie znaleziono");

    answer = { status: 429, json: { error: "rate_limited" } };
    await search("Rumia");
    await expect(status).toContainText("Za dużo wyszukiwań");

    answer = { status: 503, json: { error: "unavailable" } };
    await search("Rumia");
    await expect(status).toContainText("Wyszukiwanie adresu jest teraz niedostępne");
    await expect(page.getByRole("button", { name: "Pokaż mapę" })).toBeVisible();
    await expect(page.getByTestId("pin-status")).toHaveText("Położenie nie jest jeszcze ustawione");
  });

  test("a missing position opens the coordinates and the map at once", async ({ page }) => {
    await stubTiles(page);
    await signInAsCurator(page);
    await openNewPlace(page);
    await page.getByLabel("Nazwa", { exact: true }).fill("Bez położenia");
    await page.getByRole("button", { name: "Dodaj miejsce do kolekcji" }).click();

    const missing = page.getByText("Znajdź miejsce po adresie, ustaw pinezkę");

    await expect(missing).toBeVisible();
    await expect(missing).toBeFocused();
    await expect(page.getByLabel("Szerokość geograficzna")).toBeVisible();
    await expect(page.getByLabel("Promień potwierdzania wizyty (m)")).toBeVisible();
    await expect(page.getByTestId("place-map")).toBeVisible();
  });
});
