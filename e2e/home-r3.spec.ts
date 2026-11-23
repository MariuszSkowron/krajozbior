import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";
import sharp from "sharp";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";
import { waitForEntrance } from "./scroll-support";

// R3 / D-57 (PR 3): the new home page. A guest sees the banner with the photo of the first
// collection that has a cover (fixed photo; the draw is a later PR), the H1, two buttons and the
// credit with the place as a link. An explorer with a saved collection sees the greeting with the
// search, the cover of that collection with the progress and "Twój album" in the first screen.
// The photos are generated here (no network) into the folder the server reads as MEDIA_ROOT; the
// banner photo is white, the worst case for the contrast of the text on it. When R3_SHOTS_DIR is
// set the spec also saves screenshots (for the PR). Needs a migrated, seeded database; without
// it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const MEDIA_ROOT = resolve(".data/e2e-media");
const SHOTS_DIR = process.env.R3_SHOTS_DIR;
const EXPLORER = "user@demo.krajozbior.local";
const THEME_COOKIE = "krajozbior-theme";
const ALT = "Zamek na banerze testowym";
const PLACE_COUNT = 6;

const adminClient = () =>
  new Client({ connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL) });

type Seeded = {
  collectionId: string;
  slug: string;
  title: string;
  placeIds: string[];
  firstPlaceName: string;
};

let seeded: Seeded | null = null;
const createdKeys: string[] = [];

async function writeFiles(key: string, width: number, height: number, grey: number) {
  const directory = join(MEDIA_ROOT, "p", key.slice(0, 2), key);
  const canvas = (w: number, h: number) =>
    sharp({
      create: { width: w, height: h, channels: 3, background: { r: grey, g: grey, b: grey } },
    })
      .webp()
      .toBuffer();

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "main.webp"), await canvas(width, height));
  await writeFile(
    join(directory, "w400.webp"),
    await canvas(400, Math.max(1, Math.round((400 * height) / width))),
  );
  createdKeys.push(key);
}

// Six places in one published collection, the newest on the list, so its automatic cover (the
// white photo of the first place) is the fixed photo of the banner.
async function seed(client: Client): Promise<Seeded> {
  const org = await client.query<{ id: string }>(
    `select id from public.organizations where name = 'Gmina A (demo)'`,
  );
  const organizationId = org.rows[0]!.id;
  const suffix = randomUUID().slice(0, 8);
  const title = `Baner R3 ${suffix}`;
  const slug = `baner-r3-${suffix}`;
  const collection = await client.query<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, summary, region, status)
     values ($1, $2, $3, 'Sześć miejsc do sprawdzenia banera.', 'pomorskie', 'draft')
     returning id`,
    [slug, organizationId, title],
  );
  const collectionId = collection.rows[0]!.id;
  const placeIds: string[] = [];
  let firstPlaceName = "";

  for (let index = 0; index < PLACE_COUNT; index += 1) {
    const name = `Miejsce banera ${index + 1} ${suffix}`;
    const place = await client.query<{ id: string }>(
      `insert into public.places (organization_id, name, address, description, latitude, longitude)
       values ($1, $2, $3, 'Opis miejsca testowego', 54.1, 18.7) returning id`,
      [organizationId, name, `Ulica ${index + 1}, Gdańsk`],
    );
    const placeId = place.rows[0]!.id;
    const key = randomUUID();

    firstPlaceName = index === 0 ? name : firstPlaceName;
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
               'Fikcyjny Autor R3', 'https://commons.wikimedia.org/wiki/File:Zamek_r3.jpg',
               'cc-by-sa-3.0', 'https://creativecommons.org/licenses/by-sa/3.0/pl/',
               'CC BY-SA 3.0 PL', 'commons-import/1', $5)`,
      [
        organizationId,
        placeId,
        key,
        index === 0 ? ALT : `Zdjęcie ${index + 1}`,
        `Zamek ${index}.jpg`,
      ],
    );
    await writeFiles(key, 1600, 1067, index === 0 ? 255 : 120);
    placeIds.push(placeId);
  }

  await client.query(
    `update public.collections set status = 'published', first_published_at = now() where id = $1`,
    [collectionId],
  );

  return { collectionId, slug, title, placeIds, firstPlaceName };
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

const saveWithVisits = (visited: number) =>
  explorerData(async (client, userId) => {
    await client.query(
      `insert into public.saved_collections (user_id, collection_id) values ($1, $2)`,
      [userId, seeded!.collectionId],
    );
    for (const placeId of seeded!.placeIds.slice(0, visited)) {
      await client.query(
        `insert into public.visits (user_id, place_id, kind, date_precision)
         values ($1, $2, 'past', 'unknown')`,
        [userId, placeId],
      );
    }
  });

async function signedInPage(browser: Browser, theme: "dark" | "light" = "dark"): Promise<Page> {
  const context = await browser.newContext();

  await context.addCookies([{ name: THEME_COOKIE, value: theme, url: "http://127.0.0.1" }]);

  const page = await context.newPage();

  await page.goto("/login");
  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(EXPLORER);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);

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

async function shot(page: Page, name: string) {
  if (SHOTS_DIR === undefined) {
    return;
  }

  await mkdir(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), fullPage: false });
  await page.screenshot({ path: join(SHOTS_DIR, `${name}-full.png`), fullPage: true });
}

const overflowOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Contrast of a line of text over the photo, measured as the axe cannot (it does not see through
// a photo): the page is drawn with every text transparent, the brightest pixel under the box of
// the element is taken as the background (the worst case for light text) and compared with the
// colour of the text blended over it.
async function contrastOver(page: Page, element: Locator): Promise<number> {
  const box = (await element.boundingBox())!;
  const text = await element.evaluate((node) => {
    const probe = document.createElement("canvas").getContext("2d")!;

    probe.fillStyle = "#000";
    probe.fillStyle = getComputedStyle(node).color;
    const value = probe.fillStyle;

    // `fillStyle` gives "#rrggbb" or "rgba(r, g, b, a)".
    if (value.startsWith("#")) {
      return [
        parseInt(value.slice(1, 3), 16),
        parseInt(value.slice(3, 5), 16),
        parseInt(value.slice(5, 7), 16),
        1,
      ];
    }

    const parts = value.match(/[\d.]+/g)!.map(Number);

    // `color(srgb 1 1 1 / 0.92)` (the result of color-mix) has channels 0..1.
    if (value.startsWith("color(")) {
      return [parts[0]! * 255, parts[1]! * 255, parts[2]! * 255, parts[3] ?? 1];
    }

    return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
  });
  const hide = await page.addStyleTag({
    content:
      "* { color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } a, button { text-decoration-color: transparent !important; }",
  });
  const clip = {
    x: Math.max(0, box.x),
    y: Math.max(0, box.y),
    width: Math.max(1, box.width),
    height: Math.max(1, box.height),
  };
  const png = await page.screenshot({ clip });

  await hide.evaluate((node) => (node as Element).remove());

  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const luminance = (r: number, g: number, b: number) => {
    const lin = (v: number) => {
      const s = v / 255;

      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  let brightest = [0, 0, 0];
  let best = -1;

  for (let i = 0; i < data.length; i += info.channels) {
    const l = luminance(data[i]!, data[i + 1]!, data[i + 2]!);

    if (l > best) {
      best = l;
      brightest = [data[i]!, data[i + 1]!, data[i + 2]!];
    }
  }

  const [tr, tg, tb, ta] = text as [number, number, number, number];
  const blended = [tr, tg, tb].map((v, k) => v * ta + brightest[k]! * (1 - ta)) as [
    number,
    number,
    number,
  ];
  const a = luminance(...blended);
  const b = luminance(brightest[0]!, brightest[1]!, brightest[2]!);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test.describe("home page: the R3 look", () => {
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
    if (seeded !== null) {
      const client = adminClient();

      await client.connect();
      try {
        await client.query("delete from public.collection_places where collection_id = $1", [
          seeded.collectionId,
        ]);
        await client.query("delete from public.collections where id = $1", [seeded.collectionId]);
        await client.query("delete from public.places where id = any($1::uuid[])", [
          seeded.placeIds,
        ]);
      } finally {
        await client.end();
      }
    }

    for (const key of createdKeys.splice(0)) {
      await rm(join(MEDIA_ROOT, "p", key.slice(0, 2), key), { recursive: true, force: true });
    }
  });

  for (const size of [
    { name: "1440", width: 1440, height: 900, touch: 24 },
    { name: "390", width: 390, height: 844, touch: 44 },
  ]) {
    for (const theme of ["dark", "light"] as const) {
      test(`a guest at ${size.name} px (${theme}): the banner has H1, two buttons and the credit; contrast, touch targets, no horizontal scroll`, async ({
        browser,
      }) => {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
        });

        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: "http://127.0.0.1" }]);

        const page = await context.newPage();
        const { placeIds, firstPlaceName } = seeded!;

        await page.goto("/");
        await waitForHydration(page);
        await waitForEntrance(page);

        const main = page.getByRole("main");
        const photo = main.locator('img[fetchpriority="high"]');
        const heading = main.getByRole("heading", { level: 1, name: /Odkrywaj miejsca/ });
        const login = main.getByRole("link", { name: "Zaloguj się" });
        const collections = main.getByRole("link", { name: "Zobacz kolekcje" });
        const placeLink = main.getByRole("link", { name: firstPlaceName });

        await expect(photo).toBeVisible();
        await expect(heading).toBeVisible();
        await expect(login).toBeVisible();
        await expect(collections).toBeVisible();
        await expect(placeLink).toHaveAttribute("href", `/places/${placeIds[0]}`);
        await expect(main.getByText("Autor: Fikcyjny Autor R3")).toBeVisible();

        // Everything of the banner lies on the photo; the search is below it.
        const photoBox = (await photo.boundingBox())!;

        for (const part of [heading, login, collections, placeLink]) {
          const box = (await part.boundingBox())!;

          expect(box.y).toBeGreaterThanOrEqual(photoBox.y);
          expect(box.y + box.height).toBeLessThanOrEqual(photoBox.y + photoBox.height + 1);
        }

        expect((await placeLink.boundingBox())!.height).toBeGreaterThanOrEqual(size.touch);
        expect(await overflowOf(page)).toBeLessThanOrEqual(0);

        // Dark text on a calm placeholder is not under test here: the photo is white, the
        // text must hold 4.5:1 on it (the worst case).
        if (theme === "dark") {
          for (const part of [
            heading,
            main.getByText(/Krajozbiór to kolekcje/),
            main.getByText("Autor: Fikcyjny Autor R3"),
          ]) {
            expect(await contrastOver(page, part)).toBeGreaterThanOrEqual(4.5);
          }
        }

        const search = main.getByRole("search");
        const searchBox = (await search.boundingBox())!;

        expect(searchBox.y).toBeGreaterThanOrEqual(photoBox.y + photoBox.height - 1);
        await expect(search.getByRole("button", { name: "Szukaj" })).toHaveClass(/button--outline/);

        await expectNoAccessibilityViolations(page);
        await shot(page, `strona-gosc-${size.name}-${theme}`);
        await context.close();
      });
    }
  }

  test("a guest: the photo settles once and prefers-reduced-motion switches it off", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();

    await page.goto("/");
    await waitForHydration(page);

    const photo = page.getByRole("main").locator('img[fetchpriority="high"]');

    expect(await photo.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
    await context.close();
  });

  for (const size of [
    { name: "1440", width: 1440, height: 900, reserved: 0 },
    // On a phone the bottom bar (about 64 px) covers the lower edge of the window.
    { name: "390", width: 390, height: 844, reserved: 80 },
  ]) {
    for (const theme of ["dark", "light"] as const) {
      test(`an explorer with a saved collection at ${size.name} px (${theme}): the banner with 2/6 and "Twój album" are in the first screen`, async ({
        browser,
      }) => {
        await saveWithVisits(2);

        const page = await signedInPage(browser, theme);

        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto("/");
        await waitForHydration(page);
        await waitForEntrance(page);

        const { slug, title } = seeded!;
        const main = page.getByRole("main");
        const banner = main.getByRole("link", { name: new RegExp(title) });

        await expect(banner).toHaveAttribute("href", `/collections/${slug}`);
        await expect(banner).toContainText("Kolekcja · Pomorskie");
        await expect(banner).toContainText("2/6 odwiedzone");
        // The white photo is the worst case for the light text on it.
        for (const part of [
          banner.getByText("Kolekcja · Pomorskie"),
          banner.getByText(title),
          banner.getByText("odwiedzone", { exact: true }),
        ]) {
          expect(await contrastOver(page, part)).toBeGreaterThanOrEqual(4.5);
        }
        // The credit is outside the link (links do not nest) and under the banner.
        await expect(banner.getByRole("link")).toHaveCount(0);
        await expect(main.getByText("Autor: Fikcyjny Autor R3")).toBeVisible();

        const album = main.getByRole("heading", { level: 2, name: "Twój album" });
        const albumBox = (await album.boundingBox())!;

        // Laptop: the album is in the first screen. Phone (as in the mock-up, whose first screen
        // ends under the banner): the number 2/6 with its bar is, the album follows below.
        const visibleBottom = size.height - size.reserved;
        const progressBox = (await banner.getByText("odwiedzone", { exact: true }).boundingBox())!;

        expect(progressBox.y + progressBox.height).toBeLessThanOrEqual(visibleBottom);
        if (size.width >= 1024) {
          expect(albumBox.y + albumBox.height).toBeLessThanOrEqual(visibleBottom);
        }
        await expect(main.getByText("Odkryte miejsca")).toBeVisible();
        expect(await overflowOf(page)).toBeLessThanOrEqual(0);

        // The order: greeting and search, the banner, the album, then the rest.
        const greeting = (await main.getByRole("heading", { level: 1 }).boundingBox())!;
        const bannerBox = (await banner.boundingBox())!;

        expect(greeting.y).toBeLessThan(bannerBox.y);
        expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(albumBox.y);

        await expectNoAccessibilityViolations(page);
        await shot(page, `strona-odkrywca-${size.name}-${theme}`);
        await page.context().close();
      });
    }
  }

  test("an explorer without a saved collection: the empty state lies on the banner photo, the cards of collections have covers", async ({
    browser,
  }) => {
    const page = await signedInPage(browser);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForHydration(page);
    await waitForEntrance(page);

    const main = page.getByRole("main");
    const photo = main.locator('img[fetchpriority="high"]');
    const empty = main.getByText("Nie masz jeszcze zapisanych kolekcji");
    const photoBox = (await photo.boundingBox())!;
    const emptyBox = (await empty.boundingBox())!;

    expect(emptyBox.y).toBeGreaterThanOrEqual(photoBox.y);
    expect(emptyBox.y + emptyBox.height).toBeLessThanOrEqual(photoBox.y + photoBox.height);
    await expect(main.getByRole("link", { name: "Przeglądaj wszystkie kolekcje" })).toBeVisible();
    await expect(main.getByRole("heading", { level: 1, name: /Dzień dobry/ })).toBeVisible();
    await expect(main.getByText("Odkrywaj miejsca")).toHaveCount(0);

    // "Kolekcje do odkrycia": cards, with a link "Wszystkie kolekcje" in the heading row.
    const discover = main.locator("#do-odkrycia");

    await expect(discover.getByRole("link", { name: "Wszystkie kolekcje" })).toBeVisible();
    await expect(discover.getByRole("link", { name: /13 miejsc|6 miejsc/ }).first()).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await shot(page, "strona-odkrywca-bez-kolekcji-1440-dark");
    await page.context().close();
  });
});
