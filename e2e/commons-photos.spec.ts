import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";
import sharp from "sharp";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// E4-2b: a guest sees the photo of a place from a published collection with the full credit
// (author, licence, link to the file in Commons), the photo of a draft stays unseen, and the page
// has no accessibility violations in both themes. The photo files are generated here (no network)
// into the folder the server reads as MEDIA_ROOT (playwright.config.ts, scripts/test-env/). Needs a
// migrated, seeded database like the other specs; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const MEDIA_ROOT = resolve(".data/e2e-media");
const DEMO_PLACE_NAME = "Most Tczewski";

const AUTHOR = "Fikcyjny Autor Testowy";
const AUTHOR_URL = "https://commons.wikimedia.org/wiki/User:Fikcyjny_Autor_Testowy";
const FILE_URL = "https://commons.wikimedia.org/wiki/File:Zamek_testowy.jpg";
const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/3.0/pl/";
const ALT = "Zamek testowy nad rzeką";

async function expectNoAccessibilityViolations(page: Page) {
  // The entrance of a section (E3-2b) dims the content; axe counts contrast after the animation.
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

type Seeded = { placeId: string; photoId: string; key: string; name: string };

let publicPlace: Seeded | null = null;
let draftPlace: Seeded | null = null;
const createdCollectionIds: string[] = [];
const createdPlaceIds: string[] = [];
const createdKeys: string[] = [];

const adminClient = () =>
  new Client({ connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL) });

async function writeFiles(key: string) {
  const directory = join(MEDIA_ROOT, "p", key.slice(0, 2), key);
  const canvas = (width: number, height: number) =>
    sharp({
      create: { width, height, channels: 3, background: { r: 60, g: 90, b: 120 } },
    })
      .webp()
      .toBuffer();

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "main.webp"), await canvas(1280, 853));
  await writeFile(join(directory, "w400.webp"), await canvas(400, 267));
  createdKeys.push(key);
}

// A place with one ready photo in a collection of the demo organization; published or draft.
async function seed(client: Client, organizationId: string, published: boolean): Promise<Seeded> {
  const suffix = randomUUID().slice(0, 8);
  const place = await client.query<{ id: string }>(
    `insert into public.places (organization_id, name, description, latitude, longitude)
     values ($1, $2, 'Opis miejsca testowego', 54.1, 18.7) returning id`,
    [organizationId, `Miejsce ze zdjęciem ${suffix}`],
  );
  const placeId = place.rows[0]!.id;
  const collection = await client.query<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, region, status)
     values ($1, $2, $3, 'pomorskie', 'draft') returning id`,
    [`zdjecia-e2e-${suffix}`, organizationId, `Kolekcja zdjęć ${suffix}`],
  );
  const collectionId = collection.rows[0]!.id;

  await client.query(
    `insert into public.collection_places (collection_id, place_id, organization_id, position)
     values ($1, $2, $3, 1)`,
    [collectionId, placeId, organizationId],
  );

  if (published) {
    await client.query(`update public.collections set status = 'published' where id = $1`, [
      collectionId,
    ]);
  }

  createdCollectionIds.push(collectionId);
  createdPlaceIds.push(placeId);

  const key = randomUUID();
  const photo = await client.query<{ id: string }>(
    `insert into public.place_photos
       (organization_id, place_id, position, file_state, storage_key, width, height, alt_text,
        source_kind, title, author_text, author_url, source_url, license_code, license_url,
        license_label, rights_statement, commons_file)
     values ($1, $2, 1, 'ready', $3, 1280, 853, $4, 'commons_import', 'Zamek testowy', $5, $6, $7,
             'cc-by-sa-3.0', $8, 'CC BY-SA 3.0 PL', 'commons-import/1', 'Zamek testowy.jpg')
     returning id`,
    [organizationId, placeId, key, ALT, AUTHOR, AUTHOR_URL, FILE_URL, LICENSE_URL],
  );

  await writeFiles(key);

  return { placeId, photoId: photo.rows[0]!.id, key, name: `Miejsce ze zdjęciem ${suffix}` };
}

async function removeSeeded() {
  const collectionIds = createdCollectionIds.splice(0);
  const placeIds = createdPlaceIds.splice(0);

  if (collectionIds.length > 0 || placeIds.length > 0) {
    const client = adminClient();

    await client.connect();
    try {
      // `place_photos` rows go with their place (on delete cascade).
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

  for (const key of createdKeys.splice(0)) {
    await rm(join(MEDIA_ROOT, "p", key.slice(0, 2), key), { recursive: true, force: true });
  }
}

test.describe("photos from Wikimedia Commons", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeAll(async () => {
    const client = adminClient();

    await client.connect();
    try {
      const org = await client.query<{ id: string }>(
        `select id from public.organizations where name = 'Gmina A (demo)'`,
      );
      const organizationId = org.rows[0]!.id;

      publicPlace = await seed(client, organizationId, true);
      draftPlace = await seed(client, organizationId, false);
    } finally {
      await client.end();
    }
  });

  test.afterAll(async () => {
    await removeSeeded();
  });

  test("a guest sees the photo of a published place with the full credit and its links", async ({
    page,
  }) => {
    const { placeId, photoId } = publicPlace!;
    const response = await page.goto(`/places/${placeId}`);

    expect(response?.status()).toBe(200);

    const figure = page.getByRole("main").locator("figure");
    // The alt text is the name of the place (S3), not the title that the caption already shows.
    const image = figure.getByRole("img", { name: publicPlace!.name });

    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", `/media/p/${photoId}/main`);
    await expect(image).toHaveAttribute("srcset", new RegExp(`/media/p/${photoId}/w400 400w`));
    // The file really came through the route: a decoded image, not a broken one.
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);

    // S2: the photo is never cropped (contain, not cover).
    await expect(image).toHaveCSS("object-fit", "contain");

    const credit = figure.locator("figcaption");

    await expect(credit).toContainText(`Autor: ${AUTHOR}`);
    await expect(credit.getByRole("link", { name: AUTHOR })).toHaveAttribute("href", AUTHOR_URL);
    await expect(credit.getByRole("link", { name: "Wikimedia Commons" })).toHaveAttribute(
      "href",
      FILE_URL,
    );
    await expect(credit.getByRole("link", { name: "CC BY-SA 3.0 PL" })).toHaveAttribute(
      "href",
      LICENSE_URL,
    );
    await expect(credit).toContainText("Tytuł pliku: „Zamek testowy”.");
    await expect(credit).toContainText("Zdjęcie zmniejszyliśmy i zapisaliśmy w formacie WebP.");
    await expect(credit).toContainText("Tę kopię udostępniamy na tej samej licencji.");
  });

  test("the file of a public photo is cacheable for a day and has exactly one Content-Security-Policy", async ({
    request,
  }) => {
    const { photoId } = publicPlace!;
    const response = await request.get(`/media/p/${photoId}/w400`);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/webp");
    expect(response.headers()["cache-control"]).toBe("public, max-age=86400");
    expect(response.headers()["cross-origin-resource-policy"]).toBe("cross-origin");
    // `headersArray` keeps repeated headers apart: a second policy would show as a second entry.
    const policies = response
      .headersArray()
      .filter(({ name }) => name.toLowerCase() === "content-security-policy");

    expect(policies).toEqual([{ name: expect.any(String), value: "default-src 'none'; sandbox" }]);

    const etag = response.headers().etag!;
    const revalidated = await request.get(`/media/p/${photoId}/w400`, {
      headers: { "If-None-Match": etag },
    });

    expect(revalidated.status()).toBe(304);
  });

  // B1: nothing under /media is an HTML page. An address the photo route does not serve gets the
  // same plain 404 with the sandbox policy, never the "not found" page of the app shell.
  for (const path of ["/media", "/media/p/x", "/media/a", "/media/a/b/c/d", "/media/p/x/main/y"]) {
    test(`${path} answers a plain 404 with the sandbox policy and no HTML shell`, async ({
      request,
    }) => {
      const response = await request.get(path);

      expect(response.status()).toBe(404);
      expect(response.headers()["content-type"]).toMatch(/^text\/plain/);
      expect(response.headers()["cache-control"]).toBe("private, no-store");

      const policies = response
        .headersArray()
        .filter(({ name }) => name.toLowerCase() === "content-security-policy");

      expect(policies).toEqual([
        { name: expect.any(String), value: "default-src 'none'; sandbox" },
      ]);
      expect(await response.text()).toBe("Nie znaleziono.");
    });
  }

  test("the photo of a place that is only in a draft is not served and its page does not exist", async ({
    page,
    request,
  }) => {
    const { placeId, photoId } = draftPlace!;
    const file = await request.get(`/media/p/${photoId}/main`);

    expect(file.status()).toBe(404);
    expect(file.headers()["cache-control"]).toBe("private, no-store");

    const missing = await request.get(`/media/p/${randomUUID()}/main`);

    expect(missing.status()).toBe(404);
    expect(await missing.text()).toBe(await file.text());

    const response = await page.goto(`/places/${placeId}`);

    expect(response?.status()).toBe(404);
    await expect(page.locator("figure")).toHaveCount(0);
  });

  test("a place without a photo shows no photo block", async ({ page }) => {
    await page.goto("/collections/demo-mosty-i-zamki-nad-wisla");
    // On a desktop screen a click opens a panel (E12-4); the test goes by the address of the card.
    const href = await page
      .getByRole("main")
      .getByRole("link", { name: new RegExp(DEMO_PLACE_NAME) })
      .first()
      .getAttribute("href");

    await page.goto(href ?? "");
    await expect(page.getByRole("heading", { level: 1, name: DEMO_PLACE_NAME })).toBeVisible();
    await expect(page.locator("figure")).toHaveCount(0);
  });

  test("the photo and its credit fit a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/places/${publicPlace!.placeId}`);
    await expect(page.getByRole("img", { name: publicPlace!.name })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`the place page with a photo has no accessibility violations (theme ${theme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext();

      await context.addCookies([
        { name: "krajozbior-theme", value: theme, url: "http://127.0.0.1" },
      ]);

      const page = await context.newPage();

      await page.goto(`/places/${publicPlace!.placeId}`);
      await expect(page.getByRole("img", { name: publicPlace!.name })).toBeVisible();
      await expectNoAccessibilityViolations(page);
      await context.close();
    });
  }
});
