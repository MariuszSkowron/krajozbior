import { expect, test, type APIResponse, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// E1-S11 (R-14): the curator marks a place as fenced in the panel; a guest sees a calm notice on
// the place page, in both themes, without accessibility
// violations; after the mark is taken off the notice is gone. Needs a migrated, seeded database
// like the other specs that sign in; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const NOTICE = "place-access-notice";

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

async function created(response: APIResponse): Promise<Record<string, string | number>> {
  expect(response.ok(), await response.text()).toBe(true);

  return (await response.json()) as Record<string, string | number>;
}

// A collection that was published once cannot be deleted through the API, so the test removes
// what it created straight in the database (the admin connection of the e2e setup), also after a
// failed run.
const createdCollectionIds: string[] = [];
const createdPlaceIds: string[] = [];

async function removeCreatedData() {
  const collectionIds = createdCollectionIds.splice(0);
  const placeIds = createdPlaceIds.splice(0);

  if (collectionIds.length === 0 && placeIds.length === 0) {
    return;
  }

  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    await client.query(
      "delete from public.collection_places where collection_id = any($1::uuid[])",
      [collectionIds],
    );
    await client.query("delete from public.collections where id = any($1::uuid[])", [
      collectionIds,
    ]);
    await client.query("delete from public.places where id = any($1::uuid[])", [placeIds]);
  } finally {
    await client.end();
  }
}

test.describe("access notice of a place", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.afterEach(async () => {
    await removeCreatedData();
  });

  test("a curator marks a place as fenced, a guest sees the notice, the mark can be taken off", async ({
    browser,
    page,
  }) => {
    await page.goto("/login");

    await page.getByText("Logowanie hasłem").click();

    const form = page.locator("form", { has: page.getByLabel("Hasło") });

    await form.getByLabel("E-mail").fill("curator-a@demo.krajozbior.local");
    await form.getByLabel("Hasło").fill(password ?? "");
    await form.getByRole("button", { name: "Zaloguj się" }).click();
    await expect(page).toHaveURL(/\/my$/);

    const draft = await created(
      await page.request.post("/api/curator/collections", {
        data: { title: "Kolekcja z ostrzeżeniem", region: "pomorskie" },
      }),
    );
    const collectionId = String(draft.id);

    createdCollectionIds.push(collectionId);

    const place = await created(
      await page.request.post(`/api/curator/collections/${collectionId}/places`, {
        data: { name: "Ruiny nad drogą", address: "Gniew", latitude: 53.83, longitude: 18.82 },
      }),
    );
    const placeId = String(place.placeId);

    createdPlaceIds.push(placeId);

    await created(
      await page.request.post(`/api/curator/collections/${collectionId}/publish`, {
        data: { version: draft.version },
      }),
    );

    // The curator sets the mark in the panel.
    await page.goto(`/curator/collections/${collectionId}/places/${placeId}`);
    await waitForHydration(page);
    await expect(page.getByLabel("Wejście na teren")).toHaveValue("none");
    await page.getByLabel("Wejście na teren").selectOption("fenced");
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Zapisano zmiany miejsca." }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page);

    // A guest sees the notice on the place page, in both themes.
    for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

      await context.addCookies([
        { name: "krajozbior-theme", value: theme, url: "http://127.0.0.1" },
      ]);

      const guest = await context.newPage();

      await guest.goto(`/places/${placeId}`);
      await expect(guest.getByRole("heading", { level: 1, name: "Ruiny nad drogą" })).toBeVisible();

      const notice = guest.getByTestId(NOTICE);

      await expect(notice).toBeVisible();
      await expect(
        notice.getByRole("heading", { level: 2, name: "Wejście na teren" }),
      ).toBeVisible();
      await expect(notice).toContainText("Teren ogrodzony");
      await expect(notice).toContainText("nie wchodź na teren");
      await expectNoAccessibilityViolations(guest);
      await context.close();
    }

    // The mark taken off: the notice is gone.
    await page.goto(`/curator/collections/${collectionId}/places/${placeId}`);
    await waitForHydration(page);
    await page.getByLabel("Wejście na teren").selectOption("none");
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Zapisano zmiany miejsca." }),
    ).toBeVisible();

    const after = await browser.newContext();
    const guest = await after.newPage();

    await guest.goto(`/places/${placeId}`);
    await expect(guest.getByRole("heading", { level: 1, name: "Ruiny nad drogą" })).toBeVisible();
    await expect(guest.getByTestId(NOTICE)).toHaveCount(0);
    await after.close();
  });
});
