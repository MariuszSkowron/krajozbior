import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";
import sharp from "sharp";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// D-57, R3: wygląd strony miejsca. Laptop: zdjęcie ok. 7/12 i kolumna faktów 5/12 obok siebie,
// sekcja „Kolekcje z tym miejscem” pod spodem na całą szerokość; telefon: jedna kolumna, zdjęcie
// od krawędzi do krawędzi, bez paska powrotu. Zdjęcie zawsze w całości (contain). Ostrzeżenie o
// dostępie to etykieta, nie blok. Pliki zdjęć powstają tu (bez sieci) w folderze MEDIA_ROOT.
// Zrzuty ekranu trafiają do folderu z R3_PLACE_SHOTS_DIR, gdy zmienna jest ustawiona.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const MEDIA_ROOT = resolve(".data/e2e-media");
const SHOTS = process.env.R3_PLACE_SHOTS_DIR;

const created = { collections: [] as string[], places: [] as string[], keys: [] as string[] };
let placeId = "";
let collectionSlug = "";

const adminClient = () =>
  new Client({ connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL) });

async function writeFiles(key: string) {
  const directory = join(MEDIA_ROOT, "p", key.slice(0, 2), key);
  // Portret 800x1200: sprawdza, że zdjęcie nie jest przycinane.
  const canvas = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 70, g: 100, b: 130 } } })
      .webp()
      .toBuffer();

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "main.webp"), await canvas(800, 1200));
  await writeFile(join(directory, "w400.webp"), await canvas(400, 600));
  created.keys.push(key);
}

async function seed() {
  const client = adminClient();

  await client.connect();
  try {
    const org = await client.query<{ id: string }>(
      `select id from public.organizations where name = 'Gmina A (demo)'`,
    );
    const organizationId = org.rows[0]!.id;
    const suffix = randomUUID().slice(0, 8);
    const place = await client.query<{ id: string }>(
      `insert into public.places
         (organization_id, name, description, address, access_info, access_restriction, latitude, longitude)
       values ($1, $2, 'Renesansowy zamek nad rzeką.', 'Szczecin', 'Obejrzyj z zewnątrz.', 'fenced', 54.1, 18.7)
       returning id`,
      [organizationId, `Zamek układu ${suffix}`],
    );

    placeId = place.rows[0]!.id;
    collectionSlug = `uklad-e2e-${suffix}`;

    const collection = await client.query<{ id: string }>(
      `insert into public.collections (slug, organization_id, title, region, status)
       values ($1, $2, $3, 'zachodniopomorskie', 'draft') returning id`,
      [collectionSlug, organizationId, `Kolekcja układu ${suffix}`],
    );
    const collectionId = collection.rows[0]!.id;

    await client.query(
      `insert into public.collection_places (collection_id, place_id, organization_id, position)
       values ($1, $2, $3, 1)`,
      [collectionId, placeId, organizationId],
    );
    await client.query(`update public.collections set status = 'published' where id = $1`, [
      collectionId,
    ]);

    const key = randomUUID();

    await client.query(
      `insert into public.place_photos
         (organization_id, place_id, position, file_state, storage_key, width, height, alt_text,
          source_kind, title, author_text, source_url, license_code, license_url, license_label,
          rights_statement, commons_file)
       values ($1, $2, 1, 'ready', $3, 800, 1200, 'Zamek', 'commons_import', 'Zamek', 'Fikcyjny Autor',
               'https://commons.wikimedia.org/wiki/File:Zamek.jpg', 'cc-by-sa-3.0',
               'https://creativecommons.org/licenses/by-sa/3.0/pl/', 'CC BY-SA 3.0 PL',
               'commons-import/1', 'Zamek.jpg')`,
      [organizationId, placeId, key],
    );
    await writeFiles(key);
    created.collections.push(collectionId);
    created.places.push(placeId);
  } finally {
    await client.end();
  }
}

async function removeSeeded() {
  const client = adminClient();

  await client.connect();
  try {
    await client.query(
      "delete from public.collection_places where collection_id = any($1::uuid[])",
      [created.collections],
    );
    await client.query("delete from public.collections where id = any($1::uuid[])", [
      created.collections,
    ]);
    await client.query("delete from public.places where id = any($1::uuid[])", [created.places]);
  } finally {
    await client.end();
  }

  for (const key of created.keys) {
    await rm(join(MEDIA_ROOT, "p", key.slice(0, 2), key), { recursive: true, force: true });
  }
}

async function open(
  browser: Browser,
  options: { width: number; height: number; theme: "light" | "dark"; explorer: boolean },
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
  });

  await context.addCookies([
    { name: "krajozbior-theme", value: options.theme, url: "http://127.0.0.1" },
  ]);

  const page = await context.newPage();

  if (options.explorer) {
    await page.goto("/login");
    await page.getByText("Logowanie hasłem").click();

    const form = page.locator("form", { has: page.getByLabel("Hasło") });

    await form.getByLabel("E-mail").fill("user@demo.krajozbior.local");
    await form.getByLabel("Hasło").fill(password ?? "");
    await form.getByRole("button", { name: "Zaloguj się" }).click();
    await expect(page).toHaveURL(/\/(my)?$/);
  }

  await page.goto(`/places/${placeId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The entrance of the sections dims the content (axe counts contrast, and a screenshot would
  // show it faded): wait until every animation, also one started after hydration, has ended.
  await page.waitForFunction(() => {
    const block = document.querySelector("h1")?.parentElement?.parentElement;

    return (
      document.getAnimations().length === 0 &&
      block !== null &&
      block !== undefined &&
      getComputedStyle(block).opacity === "1"
    );
  });

  return page;
}

async function shot(page: Page, name: string) {
  if (SHOTS !== undefined) {
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({
      path: join(SHOTS, `${name}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
}

async function noViolations(page: Page) {
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

test.describe("place page, R3 layout", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeAll(seed);
  test.afterAll(removeSeeded);

  for (const theme of ["dark", "light"] as const) {
    test(`laptop 1440, guest, ${theme}: photo left, facts right, collections below`, async ({
      browser,
    }) => {
      const page = await open(browser, { width: 1440, height: 900, theme, explorer: false });
      const photo = page.getByRole("img", { name: /^Zamek układu/ });
      const facts = page.getByRole("heading", { level: 1 });
      const photoBox = (await photo.boundingBox())!;
      const factsBox = (await facts.boundingBox())!;
      const section = page.getByRole("heading", { name: "Kolekcje z tym miejscem" });
      const sectionBox = (await section.boundingBox())!;

      // The photo is the left column, the title the right one; the collections are below both.
      expect(photoBox.x + photoBox.width).toBeLessThanOrEqual(factsBox.x);
      expect(photoBox.width).toBeGreaterThan(factsBox.width);
      expect(sectionBox.y).toBeGreaterThan(photoBox.y + photoBox.height);
      // Whole photo (contain), never cropped.
      await expect(photo).toHaveCSS("object-fit", "contain");
      // The access warning is a short label with the heading inside, not a block above the photo.
      const notice = page.getByTestId("place-access-notice");

      await expect(notice.getByRole("heading", { name: "Wejście na teren" })).toBeVisible();
      expect((await notice.boundingBox())!.y).toBeGreaterThanOrEqual(factsBox.y);
      await expect(page.getByRole("link", { name: /Kolekcja układu/ })).toBeVisible();
      await shot(page, `gosc-1440-${theme}`);
      await noViolations(page);
    });

    test(`laptop 1440, explorer, ${theme}: the state of the place and the progress`, async ({
      browser,
    }) => {
      const page = await open(browser, { width: 1440, height: 900, theme, explorer: true });

      await expect(page.getByText("Do odkrycia")).toBeVisible();
      await expect(page.getByRole("button", { name: "Potwierdzam wizytę" })).toBeVisible();
      await expect(page.getByRole("progressbar", { name: /Postęp w kolekcji/ })).toBeVisible();
      await shot(page, `odkrywca-1440-${theme}`);
      await noViolations(page);
    });

    test(`phone 390, guest and explorer, ${theme}: one column, no horizontal scroll`, async ({
      browser,
    }) => {
      for (const explorer of [false, true]) {
        const page = await open(browser, { width: 390, height: 844, theme, explorer });
        const scroll = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));

        expect(scroll.width).toBeLessThanOrEqual(scroll.client);

        // No back bar; the photo reaches both edges of the screen.
        await expect(page.getByRole("link", { name: /Wróć|Powrót/ })).toHaveCount(0);

        const box = (await page.getByRole("img", { name: /^Zamek układu/ }).boundingBox())!;

        expect(box.x).toBeLessThanOrEqual(1);
        expect(box.width).toBeGreaterThanOrEqual(388);
        await shot(page, `${explorer ? "odkrywca" : "gosc"}-390-${theme}`);
        await noViolations(page);
        await page.context().close();
      }
    });
  }
});
