import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";
import sharp from "sharp";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// R3 / D-57 (PR 1): the new look of the collection page. A cover with the title (and, for the
// explorer, the big progress number) on the photo, the credit under it, the section "Miejsca w
// kolekcji" with tiles with photos, the state visited / to discover in words, sticky filters. The
// photos are generated here (no network) into the folder the server reads as MEDIA_ROOT. When
// R3_SHOTS_DIR is set the spec also saves screenshots of both widths there (for the PR). Needs a
// migrated, seeded database like the other specs; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const MEDIA_ROOT = resolve(".data/e2e-media");
const SHOTS_DIR = process.env.R3_SHOTS_DIR;
const EXPLORER = "user@demo.krajozbior.local";
const THEME_COOKIE = "krajozbior-theme";
const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const ALT = "Zamek na okładce testowej";
const PLACE_COUNT = 6;

const adminClient = () =>
  new Client({ connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL) });

type Seeded = { collectionId: string; slug: string; title: string; placeIds: string[] };

let seeded: Seeded | null = null;
const createdKeys: string[] = [];

// A solid-colour WebP of the given size (a panorama and a portrait test the "whole" rule).
async function writeFiles(key: string, width: number, height: number, colour: number) {
  const directory = join(MEDIA_ROOT, "p", key.slice(0, 2), key);
  const canvas = (w: number, h: number) =>
    sharp({
      create: { width: w, height: h, channels: 3, background: { r: colour, g: 90, b: 120 } },
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

// Six places in one published collection; every place has a ready photo, no cover is chosen (the
// automatic cover shows the photo of the first place). Place 5 has a panorama, place 6 a portrait.
async function seed(client: Client): Promise<Seeded> {
  const org = await client.query<{ id: string }>(
    `select id from public.organizations where name = 'Gmina A (demo)'`,
  );
  const organizationId = org.rows[0]!.id;
  const suffix = randomUUID().slice(0, 8);
  const title = `Układ R3 ${suffix}`;
  const slug = `uklad-r3-${suffix}`;
  const collection = await client.query<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, summary, region, status)
     values ($1, $2, $3, 'Sześć miejsc do sprawdzenia układu.', 'pomorskie', 'draft')
     returning id`,
    [slug, organizationId, title],
  );
  const collectionId = collection.rows[0]!.id;
  const sizes: [number, number][] = [
    [1600, 1067],
    [1280, 853],
    [1280, 960],
    [1280, 853],
    [2400, 600],
    [600, 900],
  ];
  const placeIds: string[] = [];

  for (let index = 0; index < PLACE_COUNT; index += 1) {
    const place = await client.query<{ id: string }>(
      `insert into public.places (organization_id, name, address, description, latitude, longitude)
       values ($1, $2, $3, 'Opis miejsca testowego', 54.1, 18.7) returning id`,
      [organizationId, `Miejsce R3 ${index + 1} ${suffix}`, `Ulica ${index + 1}, Gdańsk`],
    );
    const placeId = place.rows[0]!.id;
    const [width, height] = sizes[index]!;
    const key = randomUUID();

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
       values ($1, $2, 1, 'ready', $3, $4, $5, $6, 'commons_import', 'Zamek testowy',
               'Fikcyjny Autor R3', 'https://commons.wikimedia.org/wiki/File:Zamek_r3.jpg',
               'cc-by-sa-3.0', 'https://creativecommons.org/licenses/by-sa/3.0/pl/',
               'CC BY-SA 3.0 PL', 'commons-import/1', $7)`,
      [
        organizationId,
        placeId,
        key,
        width,
        height,
        index === 0 ? ALT : `Zdjęcie miejsca ${index + 1}`,
        `Zamek r3 ${index + 1}.jpg`,
      ],
    );
    await writeFiles(key, width, height, 40 + index * 30);
    placeIds.push(placeId);
  }

  await client.query(`update public.collections set status = 'published' where id = $1`, [
    collectionId,
  ]);

  return { collectionId, slug, title, placeIds };
}

async function visitPast(placeId: string) {
  const client = adminClient();

  await client.connect();
  try {
    await client.query(
      `insert into public.visits (user_id, place_id, kind, date_precision)
       select u.id, $2, 'past', 'unknown' from auth.users u where u.email = $1`,
      [EXPLORER, placeId],
    );
  } finally {
    await client.end();
  }
}

async function clearExplorer() {
  const client = adminClient();

  await client.connect();
  try {
    await client.query(
      `delete from public.visits where user_id in (select id from auth.users where email = $1)`,
      [EXPLORER],
    );
    await client.query(
      `delete from public.saved_collections where user_id in
         (select id from auth.users where email = $1)`,
      [EXPLORER],
    );
  } finally {
    await client.end();
  }
}

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

test.describe("collection page: the R3 look", () => {
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

  test("a guest: the title is on the automatic cover, the credit is under it, the tiles have photos and no state", async ({
    page,
  }) => {
    const { slug, title } = seeded!;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/collections/${slug}`);
    await waitForHydration(page);

    const figure = page.getByRole("main").locator("figure");
    const cover = figure.getByRole("img", { name: ALT });
    const heading = figure.getByRole("heading", { level: 1, name: title });

    await expect(cover).toBeVisible();
    await expect(figure.getByText("Kolekcja · Pomorskie")).toBeVisible();
    await expect(heading).toBeVisible();
    await expect(figure.getByText("Autor: Fikcyjny Autor R3")).toBeVisible();

    // The title lies on the photo (inside the box of the cover), the credit under the photo.
    const photoBox = (await cover.boundingBox())!;
    const titleBox = (await heading.boundingBox())!;
    const creditBox = (await figure.getByText("Autor: Fikcyjny Autor R3").boundingBox())!;

    expect(titleBox.y).toBeGreaterThanOrEqual(photoBox.y);
    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(photoBox.y + photoBox.height);
    expect(creditBox.y).toBeGreaterThanOrEqual(photoBox.y + photoBox.height);
    await expect(page.getByRole("progressbar")).toHaveCount(0);

    const tiles = page.getByRole("main").getByRole("list").getByRole("link");

    await expect(tiles).toHaveCount(PLACE_COUNT);
    await expect(tiles.first()).toContainText("01");
    await expect(page.getByText("Do odkrycia")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: /Miejsca w kolekcji \(6\)/ }),
    ).toBeVisible();
    await shot(page, "kolekcja-gosc-1440");
  });

  for (const size of [
    { name: "1440", width: 1440, height: 900, reserved: 0 },
    // On a phone the bottom bar (about 64 px) covers the lower edge of the window.
    { name: "390", width: 390, height: 844, reserved: 80 },
  ]) {
    test(`an explorer at ${size.name} px: the number 2/6 is in the first screen, states are in words, no horizontal scroll`, async ({
      browser,
    }) => {
      const { slug, placeIds } = seeded!;

      await visitPast(placeIds[1]!);
      await visitPast(placeIds[3]!);

      const page = await signedInPage(browser);

      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`/collections/${slug}`);
      await waitForHydration(page);

      const count = page.getByRole("main").locator("figure").getByText("2/6 odwiedzone");

      await expect(count).toBeAttached();

      const bar = page.getByRole("progressbar", { name: /Twój postęp w kolekcji/ });
      const box = (await bar.boundingBox())!;

      expect(box.y + box.height).toBeLessThanOrEqual(size.height - size.reserved);
      expect(await overflowOf(page)).toBeLessThanOrEqual(0);

      const tiles = page.getByRole("main").getByRole("list").getByRole("link");

      await expect(tiles.nth(1)).toContainText("Z przeszłości");
      await expect(tiles.nth(0)).toContainText("Do odkrycia");

      await shot(page, `kolekcja-odkrywca-${size.name}`);
      await page.context().close();
    });
  }

  test("an explorer: the filters stay at the top of the window while the tiles scroll, and the keyboard reaches them", async ({
    browser,
  }) => {
    const { slug, placeIds } = seeded!;

    await visitPast(placeIds[1]!);

    const page = await signedInPage(browser);

    // A low window: the page must scroll well past the place where the bar sticks (with a tall
    // window the page is only just long enough and the bar stays a few px below the top edge).
    await page.setViewportSize({ width: 1440, height: 500 });
    await page.goto(`/collections/${slug}`);
    await waitForHydration(page);

    const nav = page.getByRole("navigation", { name: "Filtr miejsc" });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);

    const top = (await nav.boundingBox())!.y;

    expect(top).toBeGreaterThanOrEqual(-1);
    expect(top).toBeLessThanOrEqual(2);

    // Tab through the page: every link of the filter is a real link with a name.
    await expect(nav.getByRole("link", { name: "Wszystkie (6)" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await nav.getByRole("link", { name: "Odwiedzone (1)" }).focus();
    await expect(nav.getByRole("link", { name: "Odwiedzone (1)" })).toBeFocused();

    const focusBox = (await nav.getByRole("link", { name: "Odwiedzone (1)" }).boundingBox())!;

    expect(focusBox.height).toBeGreaterThanOrEqual(44);
    await page.context().close();
  });

  test("a panorama and a portrait are shown whole, the other photos are cropped", async ({
    page,
  }) => {
    await page.goto(`/collections/${seeded!.slug}`);

    const images = page.getByRole("main").getByRole("list").locator("img");

    await expect(images).toHaveCount(PLACE_COUNT);

    const fits = await images.evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).objectFit),
    );

    expect(fits).toEqual(["cover", "cover", "cover", "cover", "contain", "contain"]);
  });

  test("a collection without any photo has a placeholder cover with a readable title", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/collections/${DEMO_SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("main").locator("figure")).toHaveCount(0);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await shot(page, "kolekcja-bez-zdjec-390");
  });

  for (const theme of ["dark", "light"] as const) {
    test(`no accessibility violations on the new layout (theme ${theme})`, async ({ browser }) => {
      const { slug, placeIds } = seeded!;

      await visitPast(placeIds[1]!);

      const page = await signedInPage(browser, theme);

      await page.goto(`/collections/${slug}`);
      await waitForHydration(page);
      await expect(page.locator("html")).toHaveClass(new RegExp(`theme-${theme}`));
      await expectNoAccessibilityViolations(page);
      await page.getByRole("button", { name: "Zaznacz odwiedzone" }).click();
      await expect(page.getByRole("checkbox").first()).toBeVisible();
      await expectNoAccessibilityViolations(page);

      await page.setViewportSize({ width: 390, height: 844 });
      await shot(page, `kolekcja-odkrywca-wybor-${theme}-390`);
      await page.context().close();
    });
  }
});
