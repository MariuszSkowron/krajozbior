import { expect, test, type APIResponse, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// E1, PR4: public pages of a collection and a place, seen as a guest. Needs a
// migrated, seeded database (demo accounts and the demo collection) like the
// other specs that sign in; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const DEMO_TITLE = "Mosty i zamki nad Wisłą (demo)";

async function expectNoAccessibilityViolations(page: Page) {
  // Wejście sekcji (E3-2b) przygasza treść; axe liczy kontrast dopiero po końcu animacji.
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

async function signInAsCurator(page: Page) {
  await page.goto("/login");

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill("curator-a@demo.krajozbior.local");
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);
}

async function created(response: APIResponse): Promise<Record<string, string | number>> {
  expect(response.ok(), await response.text()).toBe(true);

  return (await response.json()) as Record<string, string | number>;
}

// A collection that was published once cannot be deleted through the API (D-15),
// so the test removes what it created straight in the database, with the admin
// connection (the same one the e2e setup uses). It runs after every test, also a
// failed one, so the demo database keeps no traces.
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

test.describe("public catalog pages", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.afterEach(async () => {
    await removeCreatedData();
  });

  test("a guest reads the demo collection and a place, never from a shared cache", async ({
    page,
  }) => {
    const response = await page.goto(`/collections/${DEMO_SLUG}`);

    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toBe("private, no-store");
    await expect(page).toHaveTitle(`${DEMO_TITLE} — Krajozbiór`);
    await expect(page.getByRole("heading", { level: 1, name: DEMO_TITLE })).toBeVisible();
    await expect(page.getByText("Kurator: Gmina A (demo)")).toBeVisible();

    const places = page.getByRole("main").getByRole("list").getByRole("link");

    await expect(places).toHaveCount(3);
    await expect(places.first()).toContainText("Most Tczewski");
    await expectNoAccessibilityViolations(page);

    // On a desktop screen a click on the card opens the panel (E12-4; e2e/collection-album.spec.ts),
    // so this test goes by the address of the card, the way a phone or a browser without
    // JavaScript does.
    const placeResponse = await page.goto((await places.first().getAttribute("href")) ?? "");

    expect(placeResponse?.headers()["cache-control"]).toBe("private, no-store");
    await expect(page).toHaveURL(/\/places\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Most Tczewski" })).toBeVisible();
    await expect(page.getByRole("link", { name: DEMO_TITLE })).toHaveAttribute(
      "href",
      `/collections/${DEMO_SLUG}`,
    );
    await expectNoAccessibilityViolations(page);
  });

  test("the collection page fits a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/collections/${DEMO_SLUG}`);

    await expect(page.getByRole("heading", { level: 1, name: DEMO_TITLE })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a missing address, a draft and a withdrawn collection all give the same 'not found'", async ({
    browser,
    page,
  }) => {
    await signInAsCurator(page);

    const draft = await created(
      await page.request.post("/api/curator/collections", {
        data: { title: "Szkic z testu publicznego", region: "pomorskie" },
      }),
    );
    const slug = String(draft.slug);
    const collectionId = String(draft.id);

    createdCollectionIds.push(collectionId);
    const place = await created(
      await page.request.post(`/api/curator/collections/${collectionId}/places`, {
        data: { name: "Miejsce z testu", address: "Gniew", latitude: 53.83, longitude: 18.82 },
      }),
    );
    const placeId = String(place.placeId);

    createdPlaceIds.push(placeId);

    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();

    // The 404 page of a missing slug is the reference answer.
    const missing = await guest.goto("/collections/nie-ma-takiej-kolekcji-aaaaaa");

    expect(missing?.status()).toBe(404);
    expect(missing?.headers()["cache-control"]).toBe("private, no-store");
    await expect(guest.getByRole("heading", { level: 1, name: "Nie znaleziono" })).toBeVisible();
    const referenceBody = await guest.getByRole("main").innerText();

    async function expectNotFound(path: string, who: Page) {
      const response = await who.goto(path);

      expect(response?.status(), path).toBe(404);
      expect(response?.headers()["cache-control"], path).toBe("private, no-store");
      expect(await who.getByRole("main").innerText(), path).toBe(referenceBody);
    }

    // A draft: not found for the guest, and also for its own signed-in curator.
    await expectNotFound(`/collections/${slug}`, guest);
    await expectNotFound(`/collections/${slug}`, page);
    await expectNotFound(`/places/${placeId}`, guest);
    await expectNotFound("/places/not-a-uuid", guest);

    // Published: the guest reads it.
    const published = await created(
      await page.request.post(`/api/curator/collections/${collectionId}/publish`, {
        data: { version: draft.version },
      }),
    );

    // D-27: the address is made at the first publication; the provisional one
    // of the draft never became public.
    const publishedSlug = String(published.slug);

    expect(publishedSlug).toMatch(/^szkic-z-testu-publicznego-[a-z0-9]{6}$/);
    expect(publishedSlug).not.toBe(slug);
    await expectNotFound(`/collections/${slug}`, guest);
    await guest.goto(`/collections/${publishedSlug}`);
    await expect(
      guest.getByRole("heading", { level: 1, name: "Szkic z testu publicznego" }),
    ).toBeVisible();
    await guest.goto(`/places/${placeId}`);
    await expect(guest.getByRole("heading", { level: 1, name: "Miejsce z testu" })).toBeVisible();

    // Withdrawn: not found again, same answer as a missing one.
    await created(
      await page.request.post(`/api/curator/collections/${collectionId}/unpublish`, {
        data: { version: published.version },
      }),
    );
    await expectNotFound(`/collections/${publishedSlug}`, guest);
    await expectNotFound(`/places/${placeId}`, guest);

    await guestContext.close();
  });
});
