import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// Paczka R, K-39 and K-40: the curator sets the position of a place with a pin on the map (the map
// loads only after "Pokaż mapę"), the coordinate fields are folded away, and after a save the
// curator is back in the collection with a message at the place. The tiles are always stubbed with
// a local image, so neither CI nor an agent talks to the live OSM server. Needs a migrated, seeded
// database like the other specs that sign in; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const TILE_HOST = "tile.openstreetmap.org";
const SETTINGS = "Współrzędne i promień potwierdzania wizyty";
const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

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

// Returns the list of requests to the tile host; every tile answers with the stub.
async function stubTiles(page: Page): Promise<string[]> {
  const requested: string[] = [];

  await page.route(`https://${TILE_HOST}/**`, async (route) => {
    requested.push(route.request().url());
    await route.fulfill({ contentType: "image/png", body: TILE_PNG });
  });
  await page.route(`https://*.${TILE_HOST}/**`, (route) => route.abort());

  return requested;
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

async function newCollection(page: Page): Promise<string> {
  const response = await page.request.post("/api/curator/collections", {
    data: { title: `Edytor miejsca ${Date.now()}`, region: "pomorskie" },
  });

  expect(response.ok(), await response.text()).toBe(true);

  const id = String(((await response.json()) as { id: string }).id);

  createdCollectionIds.push(id);

  return id;
}

async function openNewPlace(page: Page, collectionId: string, name: string) {
  await page.goto(`/curator/collections/${collectionId}/places/new`);
  await waitForHydration(page);
  await page.getByLabel("Nazwa", { exact: true }).fill(name);
}

const pinStatus = (page: Page) => page.getByTestId("pin-status");

async function expectNoAccessibilityViolations(page: Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  await page.addScriptTag({ content: axe.source });

  // The whole page, the map included (as in collection-map.spec.ts): the tiles are a stubbed
  // image and the Leaflet controls are ours, so nothing needs to be excluded.
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run();

    return result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    }));
  });

  expect(violations).toEqual([]);
}

// Opens the place form in each theme (the cookie is read on a fresh load) and runs the check.
async function inBothThemes(page: Page, url: string, check: () => Promise<void>) {
  for (const theme of ["dark", "light"]) {
    await page
      .context()
      .addCookies([{ name: "krajozbior-theme", value: theme, url: "http://127.0.0.1" }]);
    await page.goto(url);
    await waitForHydration(page);
    await expect(page.locator("html")).toHaveClass(new RegExp(`theme-${theme}`));
    await check();
  }
}

test.describe("place editor with a map", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.afterEach(removeCreatedData);

  test("no tile request until the map is shown; a pin alone adds the place with a message", async ({
    page,
    baseURL,
  }) => {
    const tiles = await stubTiles(page);

    await signInAsCurator(page);

    // Every request to a host other than the app, from here until "Pokaż mapę" is clicked.
    const appHost = new URL(baseURL ?? page.url()).host;
    const foreign: string[] = [];

    page.on("request", (request) => {
      const url = new URL(request.url());

      if (/^https?:$/.test(url.protocol) && url.host !== appHost) {
        foreign.push(request.url());
      }
    });

    const collectionId = await newCollection(page);

    await openNewPlace(page, collectionId, "Miejsce z pinezki");
    await expect(pinStatus(page)).toHaveText("Położenie nie jest jeszcze ustawione");
    // The numbers are folded away.
    await expect(page.getByLabel("Szerokość geograficzna")).toBeHidden();
    expect(tiles).toEqual([]);
    expect(foreign).toEqual([]);

    await page.getByRole("button", { name: "Pokaż mapę" }).click();

    const map = page.getByTestId("place-map");

    await expect(map).toBeVisible();
    await expect(map).toBeFocused();
    await map.click({ position: { x: 200, y: 120 } });
    await expect(pinStatus(page)).toHaveText(/^Pinezka: \d+,\d+, \d+,\d+$/);
    expect(tiles.length).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Dodaj miejsce do kolekcji" }).click();
    await expect(page).toHaveURL(new RegExp(`/curator/collections/${collectionId}(\\?.*)?$`));
    await expect(page.getByRole("status").filter({ hasText: "Dodano miejsce" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Miejsce z pinezki" })).toBeVisible();
    // The parameter leaves the address, so a refresh does not repeat the message.
    await expect(page).toHaveURL(new RegExp(`/curator/collections/${collectionId}$`));
  });

  test("coordinates with a comma can be typed without opening the map", async ({ page }) => {
    const tiles = await stubTiles(page);

    await signInAsCurator(page);

    const collectionId = await newCollection(page);

    await openNewPlace(page, collectionId, "Miejsce z liczb");
    await page.getByText(SETTINGS, { exact: true }).click();
    await page.getByLabel("Szerokość geograficzna").fill("54,0928");
    await page.getByLabel("Długość geograficzna").fill("18,7919");
    await page.getByLabel("Długość geograficzna").blur();
    await expect(pinStatus(page)).toHaveText("Pinezka: 54,0928, 18,7919");
    await page.getByRole("button", { name: "Dodaj miejsce do kolekcji" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Dodano miejsce" })).toBeVisible();
    expect(tiles).toEqual([]);

    // Editing: the fields show the same format as the status line; a value out of range or not a
    // number does not move the pin.
    await page.getByRole("link", { name: "Miejsce z liczb" }).click();
    await waitForHydration(page);
    await page.getByText(SETTINGS, { exact: true }).click();
    await expect(page.getByLabel("Szerokość geograficzna")).toHaveValue("54,0928");
    await expect(pinStatus(page)).toHaveText("Pinezka: 54,0928, 18,7919");
    const pinNote = page.getByTestId("pin-note");

    await page.getByLabel("Szerokość geograficzna").fill("95");
    await page.getByLabel("Szerokość geograficzna").blur();
    await expect(pinStatus(page)).toHaveText("Pinezka: 54,0928, 18,7919");
    await expect(pinNote).toContainText("pinezka bez zmian");
    await page.getByLabel("Szerokość geograficzna").fill("abc");
    await page.getByLabel("Szerokość geograficzna").blur();
    await expect(pinStatus(page)).toHaveText("Pinezka: 54,0928, 18,7919");
    await expect(pinNote).toContainText("pinezka bez zmian");
    await page.getByLabel("Szerokość geograficzna").fill("54,5");
    await page.getByLabel("Szerokość geograficzna").blur();
    await expect(pinStatus(page)).toHaveText("Pinezka: 54,5, 18,7919");
    await expect(pinNote).toHaveText("");
    // One field empty: the old pin stays and the note says so.
    await page.getByLabel("Długość geograficzna").fill("");
    await page.getByLabel("Długość geograficzna").blur();
    await expect(pinStatus(page)).toHaveText("Pinezka: 54,5, 18,7919");
    await expect(pinNote).toContainText("pinezka bez zmian");
    // Clearing both fields takes the pin back: the line says the position is not set.
    await page.getByLabel("Szerokość geograficzna").fill("");
    await page.getByLabel("Długość geograficzna").fill("");
    await page.getByLabel("Długość geograficzna").blur();
    await expect(pinStatus(page)).toHaveText("Położenie nie jest jeszcze ustawione");
    await page.getByLabel("Szerokość geograficzna").fill("54,5");
    await page.getByLabel("Długość geograficzna").fill("18,7919");
    await page.getByLabel("Długość geograficzna").blur();
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Zapisano zmiany miejsca" }),
    ).toBeVisible();
  });

  test("the place form has no accessibility violations, new and edited, map shown, both themes", async ({
    page,
  }) => {
    await stubTiles(page);
    await signInAsCurator(page);

    const collectionId = await newCollection(page);
    const place = await page.request.post(`/api/curator/collections/${collectionId}/places`, {
      data: { name: "Miejsce do kontroli", address: "Gniew", latitude: 53.83, longitude: 18.82 },
    });

    expect(place.ok(), await place.text()).toBe(true);

    const placeId = String(((await place.json()) as { placeId: string }).placeId);

    // A new place: the folded part open, then the map shown.
    await inBothThemes(page, `/curator/collections/${collectionId}/places/new`, async () => {
      await page.getByText(SETTINGS, { exact: true }).click();
      await expect(page.getByLabel("Promień potwierdzania wizyty (m)")).toBeVisible();
      await expectNoAccessibilityViolations(page);
      await page.getByRole("button", { name: "Pokaż mapę" }).click();
      await expect(page.getByTestId("place-map")).toBeVisible();
      await expectNoAccessibilityViolations(page);
    });

    // An existing place: the same, with the position already set.
    await inBothThemes(page, `/curator/collections/${collectionId}/places/${placeId}`, async () => {
      await page.getByText(SETTINGS, { exact: true }).click();
      await expect(page.getByLabel("Promień potwierdzania wizyty (m)")).toBeVisible();
      await expectNoAccessibilityViolations(page);
      await page.getByRole("button", { name: "Pokaż mapę" }).click();
      await expect(page.getByTestId("place-map")).toBeVisible();
      await expectNoAccessibilityViolations(page);
    });
  });

  test("the pin can be set from the keyboard and the crosshair stays visible", async ({ page }) => {
    await stubTiles(page);
    await signInAsCurator(page);

    const collectionId = await newCollection(page);

    await openNewPlace(page, collectionId, "Miejsce z klawiatury");
    await page.getByRole("button", { name: "Pokaż mapę" }).click();

    const map = page.getByTestId("place-map");
    const crosshair = page.getByTestId("place-map-crosshair");

    await expect(map).toBeFocused();
    await expect(crosshair).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");

    const button = page.getByRole("button", { name: "Ustaw pinezkę na środku mapy" });

    // The zoom buttons come before it in the tab order: Tab until the button has the focus.
    for (let step = 0; step < 10; step += 1) {
      await page.keyboard.press("Tab");

      if (await button.evaluate((element) => element === document.activeElement)) {
        break;
      }
    }

    await expect(button).toBeFocused();
    await expect(crosshair).toBeVisible();
    await button.press("Enter");
    await expect(button).toBeFocused();
    await expect(crosshair).toBeVisible();
    await expect(pinStatus(page)).toHaveText(/^Pinezka: /);

    await page.getByRole("button", { name: "Ukryj mapę" }).click();
    await expect(page.getByRole("button", { name: "Pokaż mapę" })).toBeFocused();
  });

  test("a refused coordinate opens the folded part; a missing position is told before sending", async ({
    page,
  }) => {
    await stubTiles(page);
    await signInAsCurator(page);

    const collectionId = await newCollection(page);

    await openNewPlace(page, collectionId, "Miejsce z błędem");
    await page.getByRole("button", { name: "Dodaj miejsce do kolekcji" }).click();
    // No role="alert": the focus moves to the notice, so a reader says it once.
    const missing = page.getByText("Ustaw położenie pinezką na mapie");

    await expect(missing).toBeVisible();
    await expect(missing).toBeFocused();
    // The place to fix it is open at once: the fields and the map (UX-04).
    await expect(page.getByLabel("Szerokość geograficzna")).toBeVisible();
    await expect(page.getByTestId("place-map")).toBeVisible();

    await page.getByLabel("Szerokość geograficzna").fill("54,0928");
    await page.getByLabel("Długość geograficzna").fill("18,7919");
    await page.getByLabel("Promień potwierdzania wizyty (m)").fill("20");
    // Fold the part again: the refusal of the server must open it.
    await page.getByText(SETTINGS, { exact: true }).click();
    await expect(page.getByLabel("Promień potwierdzania wizyty (m)")).toBeHidden();
    await page.getByRole("button", { name: "Dodaj miejsce do kolekcji" }).click();
    await expect(page.getByLabel("Promień potwierdzania wizyty (m)")).toBeVisible();
    await expect(page.locator("main [role=alert]")).toContainText("Popraw zaznaczone pola");
  });
});
