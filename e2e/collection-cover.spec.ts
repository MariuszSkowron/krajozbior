import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";
import sharp from "sharp";

import { waitForHydration } from "../tests/support/e2e-hydration";
import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// E4-3: the cover of a collection. A guest sees it in the header of a published collection (with
// the credit) and on its card, and the page offers it as `og:image` (JPEG made by
// `photos:fetch`). A collection without a cover keeps the placeholder and has no `og:image`. A curator
// chooses the cover in the editor. The photo of a draft stays unseen. The photo files are
// generated here (no network) into the folder the server reads as MEDIA_ROOT
// (playwright.config.ts, scripts/test-env/). Needs a migrated, seeded database like the other
// specs; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const MEDIA_ROOT = resolve(".data/e2e-media");
const DEMO_COLLECTION_SLUG = "demo-mosty-i-zamki-nad-wisle";

const AUTHOR = "Fikcyjny Autor Okładki";
const ALT = "Zamek okładkowy nad rzeką";
const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/3.0/pl/";

const emailOf = (name: string) => `${name}@demo.krajozbior.local`;

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

type Seeded = {
  placeId: string;
  photoId: string;
  collectionId: string;
  slug: string;
  title: string;
};

let published: Seeded | null = null;
let draft: Seeded | null = null;
const createdCollectionIds: string[] = [];
const createdPlaceIds: string[] = [];
const createdKeys: string[] = [];

const adminClient = () =>
  new Client({ connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL) });

async function writeFiles(key: string) {
  const directory = join(MEDIA_ROOT, "p", key.slice(0, 2), key);
  const canvas = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 60, g: 90, b: 120 } } })
      .webp()
      .toBuffer();

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "main.webp"), await canvas(1280, 853));
  await writeFile(join(directory, "w400.webp"), await canvas(400, 267));
  // The og file is made by `photos:fetch`, not by the web server: the route only serves it.
  await writeFile(
    join(directory, "og.jpg"),
    await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 60, g: 90, b: 120 } },
    })
      .jpeg()
      .toBuffer(),
  );
  createdKeys.push(key);
}

// A place with one ready photo in a collection of the demo organization, the photo chosen as the
// cover (the superuser writes the cover; the guard of the database still checks it).
async function seed(client: Client, organizationId: string, isPublished: boolean): Promise<Seeded> {
  const suffix = randomUUID().slice(0, 8);
  const title = `Okładka testowa ${suffix}`;
  const place = await client.query<{ id: string }>(
    `insert into public.places (organization_id, name, description, latitude, longitude)
     values ($1, $2, 'Opis miejsca testowego', 54.1, 18.7) returning id`,
    [organizationId, `Miejsce okładki ${suffix}`],
  );
  const placeId = place.rows[0]!.id;
  const slug = `okladka-e2e-${suffix}`;
  const collection = await client.query<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, region, status)
     values ($1, $2, $3, 'pomorskie', 'draft') returning id`,
    [slug, organizationId, title],
  );
  const collectionId = collection.rows[0]!.id;

  await client.query(
    `insert into public.collection_places (collection_id, place_id, organization_id, position)
     values ($1, $2, $3, 1)`,
    [collectionId, placeId, organizationId],
  );

  if (isPublished) {
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
        source_kind, title, author_text, source_url, license_code, license_url, license_label,
        rights_statement, commons_file)
     values ($1, $2, 1, 'ready', $3, 1280, 853, $4, 'commons_import', 'Zamek okładkowy', $5,
             'https://commons.wikimedia.org/wiki/File:Zamek_okladkowy.jpg', 'cc-by-sa-3.0', $6,
             'CC BY-SA 3.0 PL', 'commons-import/1', 'Zamek okładkowy.jpg')
     returning id`,
    [organizationId, placeId, key, ALT, AUTHOR, LICENSE_URL],
  );
  const photoId = photo.rows[0]!.id;

  await client.query(`update public.collections set cover_place_photo_id = $1 where id = $2`, [
    photoId,
    collectionId,
  ]);
  await writeFiles(key);

  return { placeId, photoId, collectionId, slug, title };
}

async function coverOf(collectionId: string): Promise<string | null> {
  const client = adminClient();

  await client.connect();
  try {
    const result = await client.query<{ cover: string | null }>(
      `select cover_place_photo_id as cover from public.collections where id = $1`,
      [collectionId],
    );

    return result.rows[0]!.cover;
  } finally {
    await client.end();
  }
}

async function removeSeeded() {
  const collectionIds = createdCollectionIds.splice(0);
  const placeIds = createdPlaceIds.splice(0);

  if (collectionIds.length > 0 || placeIds.length > 0) {
    const client = adminClient();

    await client.connect();
    try {
      // `place_photos` rows go with their place (on delete cascade); the covers are cleared by
      // the foreign key (on delete set null) before the collections are deleted.
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

async function signedInCurator(browser: Browser, theme: "light" | "dark"): Promise<Page> {
  const context = await browser.newContext();

  await context.addCookies([{ name: "krajozbior-theme", value: theme, url: "http://127.0.0.1" }]);

  const page = await context.newPage();

  await page.goto("/login");

  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(emailOf("curator-a"));
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/curator$/);

  return page;
}

test.describe("collection cover", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeAll(async () => {
    const client = adminClient();

    await client.connect();
    try {
      const org = await client.query<{ id: string }>(
        `select id from public.organizations where name = 'Gmina A (demo)'`,
      );
      const organizationId = org.rows[0]!.id;

      published = await seed(client, organizationId, true);
      draft = await seed(client, organizationId, false);
    } finally {
      await client.end();
    }
  });

  test.afterAll(async () => {
    await removeSeeded();
  });

  test("a guest sees the cover in the header with the credit, and its alt text", async ({
    page,
  }) => {
    const { slug, photoId } = published!;
    const response = await page.goto(`/collections/${slug}`);

    expect(response?.status()).toBe(200);

    const figure = page.getByRole("main").locator("figure");
    const image = figure.getByRole("img", { name: ALT });

    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", `/media/p/${photoId}/main`);
    await expect(image).toHaveAttribute("srcset", new RegExp(`/media/p/${photoId}/w400 400w`));
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(figure.getByText(`fot. ${AUTHOR}`)).toBeVisible();
    await expect(figure.getByRole("link", { name: "CC BY-SA 3.0 PL" })).toHaveAttribute(
      "href",
      LICENSE_URL,
    );
  });

  test("the card of the collection shows the cover and a collection without one keeps the placeholder", async ({
    page,
  }) => {
    const { title, photoId, slug } = published!;

    await page.goto(`/search?q=${encodeURIComponent(title)}`);

    const card = page.getByRole("link", { name: new RegExp(title) });
    const image = card.getByRole("img", { name: ALT });

    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", `/media/p/${photoId}/w400`);
    // The card image is lazy: wait until the file is decoded instead of reading it at once.
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(card).toHaveAttribute("href", `/collections/${slug}`);

    // Demo collection: no cover, so the card has no photo (the decorative placeholder stays).
    await page.goto("/search?q=Mosty");

    const demoCard = page.getByRole("link", { name: /Mosty i zamki nad Wisłą/ });

    await expect(demoCard).toBeVisible();
    await expect(demoCard.locator("img")).toHaveCount(0);
  });

  test("the page offers the cover as og:image and the file is a JPEG that caches", async ({
    page,
    request,
    baseURL,
  }) => {
    const { slug, photoId } = published!;

    await page.goto(`/collections/${slug}`);

    const expected = `${baseURL}/media/p/${photoId}/og`;

    await expect(page.locator('head meta[property="og:image"]')).toHaveAttribute(
      "content",
      expected,
    );
    await expect(page.locator('head meta[name="twitter:image"]')).toHaveAttribute(
      "content",
      expected,
    );
    await expect(page.locator('head meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    // The credit is in the description of the preview, so the author shows without a click.
    const credit = `Okładka: fot. ${AUTHOR}, CC BY-SA 3.0 PL, Wikimedia Commons`;

    await expect(page.locator('head meta[property="og:description"]')).toHaveAttribute(
      "content",
      credit,
    );
    await expect(page.locator('head meta[name="twitter:description"]')).toHaveAttribute(
      "content",
      credit,
    );
    // The alt of the image stays the description of the photo.
    await expect(page.locator('head meta[property="og:image:alt"]')).toHaveAttribute(
      "content",
      ALT,
    );

    const og = await request.get(`/media/p/${photoId}/og`);
    const bytes = await og.body();

    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toBe("image/jpeg");
    expect(og.headers()["cache-control"]).toBe("public, max-age=86400");
    expect(og.headers()["cross-origin-resource-policy"]).toBe("cross-origin");
    // JPEG signature, not larger than the budget of 200 KB.
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect(bytes.length).toBeLessThanOrEqual(200 * 1024);
    expect((await sharp(bytes).metadata()).width).toBe(1200);

    const cached = await request.get(`/media/p/${photoId}/og`, {
      headers: { "if-none-match": og.headers().etag ?? "" },
    });

    expect(cached.status()).toBe(304);
  });

  test("a collection without a cover has no og:image", async ({ page }) => {
    await page.goto(`/collections/${DEMO_COLLECTION_SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('head meta[property="og:image"]')).toHaveCount(0);
    await expect(page.getByRole("main").locator("figure")).toHaveCount(0);
  });

  test("the cover of a draft is not served, not listed and its page does not exist", async ({
    page,
    request,
  }) => {
    const { slug, photoId } = draft!;

    for (const size of ["og", "main", "w400"]) {
      const file = await request.get(`/media/p/${photoId}/${size}`);

      expect(file.status()).toBe(404);
      expect(file.headers()["cache-control"]).toBe("private, no-store");
    }

    expect((await page.goto(`/collections/${slug}`))?.status()).toBe(404);
    await page.goto(`/search?q=${encodeURIComponent(draft!.title)}`);
    await expect(page.getByRole("link", { name: new RegExp(draft!.title) })).toHaveCount(0);
  });

  test("the cover and its credit fit a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/collections/${published!.slug}`);
    await expect(page.getByRole("img", { name: ALT })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a curator chooses the cover in the editor and clears it again", async ({ browser }) => {
    const { collectionId, photoId } = draft!;
    const curator = await signedInCurator(browser, "light");

    await curator.goto(`/curator/collections/${collectionId}`);
    await waitForHydration(curator);

    const section = curator.getByRole("region", { name: "Okładka kolekcji" });
    const chosen = section.getByRole("radio", { name: new RegExp(ALT) });
    const none = section.getByRole("radio", {
      name: /Automatycznie: zdjęcie pierwszego miejsca/,
    });

    // The cover set by the seed is the current choice.
    await expect(chosen).toBeChecked();

    await none.check();
    await section.getByRole("button", { name: "Zapisz okładkę" }).click();
    await expect(section.getByText(/Okładka jest teraz wybierana automatycznie/)).toBeVisible();
    expect(await coverOf(collectionId)).toBeNull();

    await chosen.check();
    await section.getByRole("button", { name: "Zapisz okładkę" }).click();
    await expect(section.getByText(/Okładka zapisana/)).toBeVisible();
    expect(await coverOf(collectionId)).toBe(photoId);

    await curator.context().close();
  });

  test("publishing with unsaved text keeps the text and asks to save first", async ({
    browser,
  }) => {
    const curator = await signedInCurator(browser, "light");

    await curator.goto(`/curator/collections/${draft!.collectionId}`);
    await waitForHydration(curator);

    const summary = curator.getByLabel("Krótki opis");

    await summary.fill("Tekst, którego jeszcze nie zapisano.");
    await curator.getByRole("button", { name: "Publikuj" }).click();

    await expect(curator.getByText("Najpierw zapisz zmiany kolekcji.")).toBeVisible();
    await expect(curator.getByText("Masz niezapisane zmiany", { exact: true })).toBeVisible();
    await curator.getByRole("button", { name: "Przejdź do zapisu" }).click();
    await expect(curator.getByRole("button", { name: "Zapisz zmiany" })).toBeFocused();
    await expect(summary).toHaveValue("Tekst, którego jeszcze nie zapisano.");
    // Still a draft: nothing was published.
    await expect(curator.getByRole("button", { name: "Publikuj" })).toBeVisible();

    await curator.context().close();
  });

  test("a curator of another organization has no such collection", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");

    await page.getByText("Logowanie hasłem").click();

    const form = page.locator("form", { has: page.getByLabel("Hasło") });

    await form.getByLabel("E-mail").fill(emailOf("curator-b"));
    await form.getByLabel("Hasło").fill(password ?? "");
    await form.getByRole("button", { name: "Zaloguj się" }).click();
    await expect(page).toHaveURL(/\/curator$/);

    const response = await page.request.put(
      `/api/curator/collections/${published!.collectionId}/cover`,
      { data: {}, headers: { origin: new URL(page.url()).origin } },
    );

    expect(response.status()).toBe(404);
    expect(await coverOf(published!.collectionId)).toBe(published!.photoId);
    await context.close();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`the collection page with a cover has no accessibility violations (theme ${theme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext();

      await context.addCookies([
        { name: "krajozbior-theme", value: theme, url: "http://127.0.0.1" },
      ]);

      const page = await context.newPage();

      await page.goto(`/collections/${published!.slug}`);
      await expect(page.getByRole("img", { name: ALT })).toBeVisible();
      await expectNoAccessibilityViolations(page);

      await page.goto(`/search?q=${encodeURIComponent(published!.title)}`);
      await expect(page.getByRole("img", { name: ALT })).toBeVisible();
      await expectNoAccessibilityViolations(page);
      await context.close();
    });

    test(`the cover picker of the editor has no accessibility violations (theme ${theme})`, async ({
      browser,
    }) => {
      const curator = await signedInCurator(browser, theme);

      await curator.goto(`/curator/collections/${draft!.collectionId}`);
      await waitForHydration(curator);
      await expect(
        curator.getByRole("region", { name: "Okładka kolekcji" }).getByRole("radio", {
          name: new RegExp(ALT),
        }),
      ).toBeVisible();
      await expectNoAccessibilityViolations(curator);
      await curator.context().close();
    });
  }
});
