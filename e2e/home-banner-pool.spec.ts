import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import sharp from "sharp";

import { HOME_BANNER_POOL } from "../src/features/catalog/domain/home-banner-pool";
import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";
import { buttonContrast, contrastOver } from "./contrast-support";
import { waitForEntrance } from "./scroll-support";

// R3 / D-57 (PR 4): the banner of a guest is drawn from the pool of chosen places on the server,
// on every request. Three places of the pool are seeded here (QIDs from the list in the code,
// published collection, photos generated into the folder the server reads as MEDIA_ROOT); the
// first has a white photo, the worst case for the contrast of the text on it. When R3_SHOTS_DIR
// is set the spec also saves screenshots of the drawn banners (for the PR). Needs a migrated,
// seeded database; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const MEDIA_ROOT = resolve(".data/e2e-media");
const SHOTS_DIR = process.env.R3_SHOTS_DIR;
const THEME_COOKIE = "krajozbior-theme";

const adminClient = () =>
  new Client({ connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL) });

type Seeded = { collectionId: string; places: { id: string; name: string; qid: string }[] };

let seeded: Seeded | null = null;
const createdKeys: string[] = [];

// A calm landscape (sky over a darker ground) or a white photo, so the shots show something.
async function pixels(kind: "white" | "sky" | "dusk", width: number, height: number) {
  if (kind === "white") {
    return sharp({
      create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .webp()
      .toBuffer();
  }

  const [top, bottom] = kind === "sky" ? ["#8ec5ff", "#4c8a3c"] : ["#e8a35d", "#3b2a4a"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.6" stop-color="${top}"/><stop offset="0.62" stop-color="${bottom}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;

  return sharp(Buffer.from(svg)).webp().toBuffer();
}

async function writeFiles(key: string, kind: "white" | "sky" | "dusk") {
  const directory = join(MEDIA_ROOT, "p", key.slice(0, 2), key);

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "main.webp"), await pixels(kind, 1600, 1067));
  await writeFile(join(directory, "w400.webp"), await pixels(kind, 400, 267));
  createdKeys.push(key);
}

async function seed(client: Client): Promise<Seeded> {
  const org = await client.query<{ id: string }>(
    `select id from public.organizations where name = 'Gmina A (demo)'`,
  );
  const organizationId = org.rows[0]!.id;
  const suffix = randomUUID().slice(0, 8);
  const collection = await client.query<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, summary, region, status)
     values ($1, $2, $3, 'Miejsca puli banera.', 'pomorskie', 'draft') returning id`,
    [`pula-banera-${suffix}`, organizationId, `Pula banera ${suffix}`],
  );
  const collectionId = collection.rows[0]!.id;
  const places: Seeded["places"] = [];
  const kinds = ["white", "sky", "dusk"] as const;

  for (const [index, kind] of kinds.entries()) {
    const qid = HOME_BANNER_POOL[index]!.qid;
    const name = `Miejsce z puli ${index + 1} ${suffix}`;
    const place = await client.query<{ id: string }>(
      `insert into public.places (organization_id, name, address, description, latitude, longitude)
       values ($1, $2, 'Ulica 1, Szczecin', 'Opis miejsca testowego', 53.4, 14.5) returning id`,
      [organizationId, name],
    );
    const placeId = place.rows[0]!.id;
    const key = randomUUID();

    await client.query(
      `insert into public.place_sources
         (place_id, organization_id, wikidata_qid, description_method, attribution, retrieved_at)
       values ($1, $2, $3, 'facts_template', 'Wikidata (CC0)', now())`,
      [placeId, organizationId, qid],
    );
    await client.query(
      `insert into public.collection_places (collection_id, place_id, organization_id, position)
       values ($1, $2, $3, $4)`,
      [collectionId, placeId, organizationId, index + 1],
    );
    await client.query(
      `insert into public.place_photos
         (organization_id, place_id, position, file_state, storage_key, width, height, alt_text,
          source_kind, title, author_text, source_url, license_code, license_url, license_label,
          rights_statement, commons_file)
       values ($1, $2, 1, 'ready', $3, 1600, 1067, $4, 'commons_import', 'Zamek testowy',
               $5, 'https://commons.wikimedia.org/wiki/File:Pula_r3.jpg',
               'cc-by-sa-3.0', 'https://creativecommons.org/licenses/by-sa/3.0/pl/',
               'CC BY-SA 3.0 PL', 'commons-import/1', $6)`,
      [
        organizationId,
        placeId,
        key,
        `Zdjęcie z puli ${index + 1}`,
        `Fikcyjny Autor Puli ${index + 1}`,
        `Pula ${suffix} ${index}.jpg`,
      ],
    );
    await writeFiles(key, kind);
    places.push({ id: placeId, name, qid });
  }

  await client.query(
    `update public.collections set status = 'published', first_published_at = now() where id = $1`,
    [collectionId],
  );

  return { collectionId, places };
}

const placeIdOf = (html: string, ids: string[]) =>
  ids.find((id) => html.includes(`href="/places/${id}"`)) ?? null;

// The draw is random, so a page is loaded until the banner shows the wanted place (three places:
// a miss is 2/3 per try, so 60 tries leave about 3e-11 of a false failure).
async function loadWith(page: Page, placeId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await page.goto("/");

    if ((await page.locator(`main a[href="/places/${placeId}"]`).count()) > 0) {
      return;
    }
  }

  throw new Error("the banner never drew the place");
}

test.describe("home page: the drawn banner of a guest", () => {
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

  test.afterAll(async () => {
    if (seeded !== null) {
      const client = adminClient();

      await client.connect();
      try {
        await client.query("delete from public.collection_places where collection_id = $1", [
          seeded.collectionId,
        ]);
        await client.query("delete from public.collections where id = $1", [seeded.collectionId]);
        await client.query("delete from public.places where id = any($1::uuid[])", [
          seeded.places.map(({ id }) => id),
        ]);
      } finally {
        await client.end();
      }
    }

    for (const key of createdKeys.splice(0)) {
      await rm(join(MEDIA_ROOT, "p", key.slice(0, 2), key), { recursive: true, force: true });
    }
  });

  test("every load shows a place of the pool with its credit and a link to it, and the draws differ", async ({
    request,
  }) => {
    const ids = seeded!.places.map(({ id }) => id);
    const seen = new Set<string>();

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const html = await (await request.get("/")).text();
      const drawn = placeIdOf(html, ids);

      // The server HTML already has the right photo and the credit (no draw in the browser).
      expect(drawn).not.toBeNull();

      const place = seeded!.places.find(({ id }) => id === drawn)!;
      const index = seeded!.places.indexOf(place) + 1;

      expect(html).toContain(place.name);
      expect(html).toContain(`Autor:`);
      expect(html).toContain(`Fikcyjny Autor Puli ${index}`);
      expect(html).toContain("CC BY-SA 3.0 PL");
      expect(html).toMatch(/src="\/media\/p\/[0-9a-f-]+\/main"/);
      seen.add(drawn!);
    }

    // Three places, 30 draws: all the same has the chance of about 1e-14.
    expect(seen.size).toBeGreaterThan(1);
  });

  test("the crop of the place comes from the pool: wide on a laptop, narrow on a phone", async ({
    browser,
  }) => {
    const target = seeded!.places[1]!;
    const focus = HOME_BANNER_POOL.find(({ qid }) => qid === target.qid)!.focus;

    for (const [width, height, expected] of [
      [1440, 900, focus.wide],
      [390, 844, focus.narrow],
    ] as const) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();

      await loadWith(page, target.id);
      await waitForHydration(page);
      await waitForEntrance(page);

      const position = await page
        .getByRole("main")
        .locator('img[fetchpriority="high"]')
        .evaluate((node) => getComputedStyle(node).objectPosition);

      // The browser gives "50% 40%" as it was written.
      expect(position).toBe(expected);
      await context.close();
    }
  });

  for (const size of [
    { name: "1440", width: 1440, height: 900 },
    { name: "1024", width: 1024, height: 768 },
    { name: "834", width: 834, height: 1112 },
    { name: "390", width: 390, height: 844 },
  ]) {
    test(`white photo of the pool at ${size.name} px: text holds 4.5:1, the place link is a touch target`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
      });

      await context.addCookies([{ name: THEME_COOKIE, value: "dark", url: "http://127.0.0.1" }]);

      const page = await context.newPage();
      const white = seeded!.places[0]!;

      await loadWith(page, white.id);
      await waitForHydration(page);
      await waitForEntrance(page);

      const main = page.getByRole("main");
      const placeLink = main.getByRole("link", { name: white.name });

      await expect(placeLink).toHaveAttribute("href", `/places/${white.id}`);
      expect((await placeLink.boundingBox())!.height).toBeGreaterThanOrEqual(
        size.width < 768 ? 44 : 24,
      );

      for (const part of [
        main.getByRole("heading", { level: 1, name: /Odkrywaj miejsca/ }),
        main.getByText(/Gotowe kolekcje miejsc/),
        main.getByText("Masz już konto?"),
        main.getByText("Autor: Fikcyjny Autor Puli 1"),
      ]) {
        expect(await contrastOver(page, part)).toBeGreaterThanOrEqual(4.5);
      }

      // The buttons on the white photo: text 4.5:1 on the fill, the boundary 3:1 on the photo.
      for (const part of [
        main.getByRole("link", { name: "Załóż konto" }),
        main.getByRole("link", { name: "Zobacz kolekcje" }),
      ]) {
        const { text, boundary } = await buttonContrast(page, part);
        // The text over what is really drawn under it (fill, blur and photo together).
        const drawnUnder = await contrastOver(page, part, 3);

        expect(text).toBeGreaterThanOrEqual(4.5);
        expect(drawnUnder).toBeGreaterThanOrEqual(4.5);
        expect(boundary).toBeGreaterThanOrEqual(3);
      }

      await context.close();
    });
  }

  test("screenshots of three drawn banners (only when R3_SHOTS_DIR is set)", async ({
    browser,
  }) => {
    test.skip(SHOTS_DIR === undefined, "R3_SHOTS_DIR is not set");

    await mkdir(SHOTS_DIR!, { recursive: true });

    for (const [index, place] of seeded!.places.entries()) {
      for (const [width, height] of [
        [1440, 900],
        [390, 844],
      ] as const) {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();

        await loadWith(page, place.id);
        await waitForHydration(page);
        await waitForEntrance(page);
        await page.screenshot({ path: join(SHOTS_DIR!, `baner-${index + 1}-${width}.png`) });
        await context.close();
      }
    }
  });
});
