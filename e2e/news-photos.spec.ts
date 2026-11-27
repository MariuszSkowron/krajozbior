import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";
import sharp from "sharp";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// Aktualności ze zdjęciami (paczka 5, faza A): wpis dziedziczy zdjęcie powiązanego miejsca, lista
// to szerokie karty jedna pod drugą, strona wpisu zaczyna się okładką z podpisem. Zdjęcia i pliki
// powstają tu (bez sieci) w folderze, który serwer czyta jako MEDIA_ROOT; wiersze i pliki test
// usuwa. Wymaga zmigrowanej, zasianej bazy jak inne specyfikacje; bez niej jest pomijana.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const MEDIA_ROOT = resolve(".data/e2e-media");
const SHOTS = resolve(".ai/tmp/p5/zrzuty");

const AUTHOR = "Fikcyjny Autor Aktualności";
const ALT = "Zamek ze zdjęcia aktualności";
const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/3.0/pl/";

const WITH_PHOTO = { slug: "e2e-zdjecia-ze-zdjeciem", title: "E2E Wpis ze zdjęciem miejsca" };
const LIGHT_PHOTO = { slug: "e2e-zdjecia-jasne", title: "E2E Wpis z jasnym zdjęciem" };
const NO_PHOTO = { slug: "e2e-zdjecia-bez", title: "E2E Wpis bez zdjęcia" };
const NO_PHOTO_EVENT = { slug: "e2e-zdjecia-wydarzenie", title: "E2E Wydarzenie bez zdjęcia" };
const SLUGS = [WITH_PHOTO.slug, LIGHT_PHOTO.slug, NO_PHOTO.slug, NO_PHOTO_EVENT.slug];

const VIEWS = { 390: { width: 390, height: 844 }, 1440: { width: 1440, height: 900 } } as const;
const THEMES = ["light", "dark"] as const;

const createdCollectionIds: string[] = [];
const createdPlaceIds: string[] = [];
const createdKeys: string[] = [];
const photoIds: Record<string, string> = {};

const adminClient = () =>
  new Client({ connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL) });

async function writeFiles(key: string, color: { r: number; g: number; b: number }) {
  const directory = join(MEDIA_ROOT, "p", key.slice(0, 2), key);
  const canvas = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: color } });

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "main.webp"), await canvas(1280, 853).webp().toBuffer());
  await writeFile(join(directory, "w400.webp"), await canvas(400, 267).webp().toBuffer());
  await writeFile(join(directory, "og.jpg"), await canvas(1200, 800).jpeg().toBuffer());
  createdKeys.push(key);
}

// Miejsce z jednym gotowym zdjęciem w opublikowanej kolekcji organizacji redakcji i wpis, który
// to miejsce (i kolekcję) wskazuje.
async function seedPost(
  client: Client,
  organizationId: string,
  post: { slug: string; title: string },
  color: { r: number; g: number; b: number },
) {
  const suffix = randomUUID().slice(0, 8);
  const place = await client.query<{ id: string }>(
    `insert into public.places (organization_id, name, description, latitude, longitude)
     values ($1, $2, 'Opis miejsca testowego', 54.1, 18.7) returning id`,
    [organizationId, `Miejsce aktualności ${suffix}`],
  );
  const placeId = place.rows[0]!.id;
  const collection = await client.query<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, region, status)
     values ($1, $2, $3, 'pomorskie', 'draft') returning id`,
    [`aktualnosci-e2e-${suffix}`, organizationId, `Kolekcja aktualności ${suffix}`],
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
  createdCollectionIds.push(collectionId);
  createdPlaceIds.push(placeId);

  const key = randomUUID();
  const photo = await client.query<{ id: string }>(
    `insert into public.place_photos
       (organization_id, place_id, position, file_state, storage_key, width, height, alt_text,
        source_kind, title, author_text, source_url, license_code, license_url, license_label,
        rights_statement, commons_file)
     values ($1, $2, 1, 'ready', $3, 1280, 853, $4, 'commons_import', 'Zamek aktualności', $5,
             'https://commons.wikimedia.org/wiki/File:Zamek_aktualnosci.jpg', 'cc-by-sa-3.0', $6,
             'CC BY-SA 3.0 PL', 'commons-import/1', 'Zamek aktualności.jpg')
     returning id`,
    [organizationId, placeId, key, ALT, AUTHOR, LICENSE_URL],
  );

  photoIds[post.slug] = photo.rows[0]!.id;
  await writeFiles(key, color);
  await client.query(
    `insert into public.news_posts
       (organization_id, slug, kind, title, lead, body, place_id, collection_id, status)
     values ($1, $2, 'guide', $3, 'Krótki tekst aktualności ze zdjęciem.', 'Treść wpisu.', $4, $5,
             'published')`,
    [organizationId, post.slug, post.title, placeId, collectionId],
  );
}

async function removeOwnRows() {
  const client = adminClient();

  await client.connect();
  try {
    await client.query("delete from public.news_posts where slug = any($1::text[])", [SLUGS]);

    const collectionIds = createdCollectionIds.splice(0);
    const placeIds = createdPlaceIds.splice(0);

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

  for (const key of createdKeys.splice(0)) {
    await rm(join(MEDIA_ROOT, "p", key.slice(0, 2), key), { recursive: true, force: true });
  }
}

async function open(page: Page, theme: (typeof THEMES)[number], path: string) {
  await page
    .context()
    .addCookies([{ name: "krajozbior-theme", value: theme, url: "http://127.0.0.1" }]);
  await page.goto(path);
  await waitForHydration(page);
  await expect(page.locator("html")).toHaveClass(new RegExp(`theme-${theme}`));
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
}

async function shot(page: Page, name: string) {
  await mkdir(SHOTS, { recursive: true });
  // Obrazy `loading="lazy"` ładują się dopiero po przewinięciu: przewiń do końca i z powrotem.
  await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((resolve) => setTimeout(resolve, 400));
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

const luminance = (r: number, g: number, b: number) => {
  const channel = (value: number) => {
    const v = value / 255;

    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// Najgorszy kontrast tekstu elementu ze zdjęciem pod nim: tekst chowamy (przezroczysty), robimy
// zrzut jego pola i bierzemy najjaśniejszy piksel tła (tekst jest jasny); axe nie mierzy tła
// obrazkowego.
async function worstContrast(page: Page, selector: string) {
  const target = page.locator(selector).first();
  const { color, box } = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();

    return {
      color: getComputedStyle(element).color,
      box: {
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        w: rect.width,
        h: rect.height,
      },
    };
  });
  const [r, g, b] = color.match(/\d+/g)!.map(Number) as [number, number, number];

  await target.evaluate((element) => {
    (element as HTMLElement).style.color = "transparent";
  });

  const png = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.w, height: box.h },
    fullPage: true,
  });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let brightest = 0;

  for (let i = 0; i < data.length; i += info.channels) {
    brightest = Math.max(brightest, luminance(data[i]!, data[i + 1]!, data[i + 2]!));
  }

  return contrast(luminance(r, g, b), brightest);
}

test.describe("aktualności ze zdjęciami", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeAll(async () => {
    await removeOwnRows();

    const client = adminClient();

    await client.connect();
    try {
      const org = (
        await client.query<{ id: string }>(
          "select id from public.organizations where slug = 'krajozbior-redakcja'",
        )
      ).rows[0];

      if (org === undefined) {
        throw new Error("The editorial organization is missing: run seed:demo first");
      }

      await seedPost(client, org.id, WITH_PHOTO, { r: 60, g: 90, b: 120 });
      // Jasne zdjęcie do kontroli kontrastu tytułu i etykiety na okładce (axe tego nie mierzy).
      await seedPost(client, org.id, LIGHT_PHOTO, { r: 240, g: 240, b: 240 });
      await client.query(
        `insert into public.news_posts (organization_id, slug, kind, title, lead, body, status)
         values ($1, $2, 'guide', $3, 'Krótki tekst wpisu bez powiązania.', 'Treść wpisu.',
                 'published')`,
        [org.id, NO_PHOTO.slug, NO_PHOTO.title],
      );
      await client.query(
        `insert into public.news_posts
           (organization_id, slug, kind, title, lead, body, event_starts_on, status)
         values ($1, $2, 'event', $3, 'Krótki tekst wydarzenia.', '', '2099-06-01', 'published')`,
        [org.id, NO_PHOTO_EVENT.slug, NO_PHOTO_EVENT.title],
      );
    } finally {
      await client.end();
    }
  });

  test.afterAll(async () => {
    await removeOwnRows();
  });

  for (const [width, viewport] of Object.entries(VIEWS)) {
    for (const theme of THEMES) {
      test(`lista i wpis ze zdjęciem: karty na całą szerokość, miniatura, okładka z podpisem, kontrast (${width} px, ${theme})`, async ({
        browser,
      }) => {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();

        await open(page, theme, "/news");

        // Karty leżą jedna pod drugą na całą szerokość listy (A-01).
        const list = page.getByRole("main").locator("ul", { has: page.locator("article") });
        const listBox = (await list.boundingBox())!;
        const cards = await list.locator("article").all();

        expect(cards.length).toBeGreaterThanOrEqual(3);

        let previousBottom = -1;

        for (const card of cards) {
          const box = (await card.boundingBox())!;

          expect(Math.abs(box.width - listBox.width)).toBeLessThanOrEqual(1);
          expect(box.y).toBeGreaterThanOrEqual(previousBottom - 1);
          previousBottom = box.y + box.height;
        }

        // Miniatura zdjęcia miejsca bez podpisu (A-02, A-04).
        const withPhoto = list.locator("article", { hasText: WITH_PHOTO.title });
        const thumb = withPhoto.locator("img");

        await expect(thumb).toHaveAttribute("src", `/media/p/${photoIds[WITH_PHOTO.slug]}/w400`);
        await expect(thumb).toHaveAttribute("alt", "");

        // S-3, M-1: zwykłe karty biorą miniaturę `w400` na każdej szerokości (kolumna zdjęcia
        // najwyżej 400 px); plik główny dostaje tylko karta wyróżniona (pierwsza), od 48 rem.
        for (const [index, card] of cards.entries()) {
          const image = card.locator("img");

          if ((await image.count()) === 0) {
            continue;
          }

          const expectedFile = index === 0 && viewport.width >= 768 ? "main" : "w400";

          await image.scrollIntoViewIfNeeded();
          await expect
            .poll(() => image.evaluate((img: HTMLImageElement) => img.currentSrc))
            .toMatch(new RegExp(`/media/p/[^/]+/${expectedFile}$`));

          if (index > 0 && viewport.width >= 768) {
            // Miniatura nie jest rozciągnięta: kolumna zdjęcia zwykłej karty ma najwyżej 400 px.
            expect((await image.boundingBox())!.width).toBeLessThanOrEqual(401);
          }
        }

        // S-2: na telefonie karta jest niska (na ekranie mieszczą się dwie).
        if (viewport.width < 768) {
          for (const card of cards) {
            expect((await card.boundingBox())!.height).toBeLessThanOrEqual(viewport.height / 2);
          }
        }

        await thumb.scrollIntoViewIfNeeded();
        await expect
          .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
          .toBeGreaterThan(0);
        await expect(withPhoto).not.toContainText(AUTHOR);

        // Wpis bez powiązania: tło zastępcze, żaden img nie ma pustego src.
        const none = list.locator("article", { hasText: NO_PHOTO.title });

        await expect(none.locator("img")).toHaveCount(0);
        await expect(none.getByRole("link")).toHaveCount(1);

        // S-1: karta bez zdjęcia nie rezerwuje pola zdjęcia; tekst zajmuje całą szerokość karty.
        const noneBox = (await none.boundingBox())!;
        const bodyBox = (await none.locator("h2").boundingBox())!;

        expect(bodyBox.x - noneBox.x).toBeLessThan(noneBox.width / 10);
        for (const src of await list
          .locator("img")
          .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src")))) {
          expect(src).toBeTruthy();
        }

        await shot(page, `lista-${width}-${theme}`);

        // Strona wpisu: okładka z rodzajem i h1, podpis z linkiem licencji.
        await open(page, theme, `/news/${WITH_PHOTO.slug}`);

        const article = page.getByRole("article");
        const figure = article.locator("figure");
        const cover = figure.getByRole("img", { name: ALT });

        await expect(cover).toHaveAttribute("src", `/media/p/${photoIds[WITH_PHOTO.slug]}/main`);
        await expect
          .poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth))
          .toBeGreaterThan(0);
        await expect(article.getByRole("heading", { level: 1 })).toHaveText(WITH_PHOTO.title);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(figure.getByText("Poradnik")).toBeVisible();
        await expect(figure.getByText(AUTHOR)).toBeVisible();
        await expect(figure.getByRole("link", { name: "CC BY-SA 3.0 PL" })).toHaveAttribute(
          "href",
          LICENSE_URL,
        );
        // N-1: powrót nad okładką, tak jak we wpisie bez zdjęcia.
        const back = article.getByRole("link", { name: "← Wszystkie aktualności" });

        await expect(back).toBeVisible();
        expect((await back.boundingBox())!.y).toBeLessThan((await figure.boundingBox())!.y);

        // D-58 pkt 3: podpis w jednej linii z nazwą miejsca (link), „fot.” i licencją.
        const caption = figure.locator("figcaption");

        await expect(caption.getByRole("link", { name: /^Miejsce aktualności / })).toHaveAttribute(
          "href",
          /^\/places\/[0-9a-f-]{36}$/,
        );
        await expect(caption).toContainText(`· fot. ${AUTHOR}`);
        await expect(caption).toContainText("zdjęcie zmniejszone");
        await expect(caption).not.toContainText("Autor:");
        expect(await caption.locator("p").count()).toBe(1);
        await shot(page, `wpis-${width}-${theme}`);

        // Kontrast na jasnym zdjęciu: etykieta >= 4,5:1, tytuł (duży tekst) >= 3:1.
        await open(page, theme, `/news/${LIGHT_PHOTO.slug}`);

        const label = await worstContrast(page, "figure p");
        const heading = await worstContrast(page, "figure h1");

        test.info().annotations.push({
          type: "kontrast",
          description: `${width} ${theme}: etykieta ${label.toFixed(2)}, tytuł ${heading.toFixed(2)}`,
        });
        expect(label).toBeGreaterThanOrEqual(4.5);
        expect(heading).toBeGreaterThanOrEqual(3);

        await open(page, theme, `/news/${LIGHT_PHOTO.slug}`);
        await shot(page, `wpis-jasne-${width}-${theme}`);

        await context.close();
      });
    }
  }

  for (const theme of THEMES) {
    test(`wpis bez zdjęcia: nagłówek tekstowy bez okładki i tło zastępcze na liście (${theme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: VIEWS[390] });
      const page = await context.newPage();

      await open(page, theme, `/news/${NO_PHOTO.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("article").locator("figure, img")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(NO_PHOTO.title);
      await shot(page, `wpis-bez-390-${theme}`);

      // Lista, w której żaden wpis nie ma zdjęcia (stan serwera przed poprawką danych): same karty z tłem.
      await open(page, theme, "/news?filtr=wydarzenia");
      await expect(page.getByRole("main").locator("img")).toHaveCount(0);
      await shot(page, `lista-bez-zdjec-390-${theme}`);
      await context.close();
    });
  }

  for (const theme of THEMES) {
    test(`fokus klawiaturą: jeden obrys całej karty z kontrastem 3:1, Enter otwiera wpis (${theme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: VIEWS[1440] });
      const page = await context.newPage();

      await open(page, theme, "/news");

      const firstCard = page.getByRole("main").locator("article").first();
      const link = firstCard.getByRole("link");
      const href = await link.getAttribute("href");

      for (let i = 0; i < 40; i += 1) {
        await page.keyboard.press("Tab");
        if (await link.evaluate((element) => element === document.activeElement)) {
          break;
        }
      }

      await expect(link).toBeFocused();
      expect(
        await firstCard.evaluate((element) => getComputedStyle(element).outlineStyle),
      ).not.toBe("none");
      // Tytuł nie rysuje własnego obrysu: jest jeden, wokół karty (K-4).
      expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");

      const { outline, background, width } = await firstCard.evaluate((element) => {
        const style = getComputedStyle(element);

        return {
          outline: style.outlineColor,
          width: Number.parseFloat(style.outlineWidth),
          background: getComputedStyle(document.body).backgroundColor,
        };
      });
      const rgb = (value: string) =>
        value.match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number];

      expect(width).toBeGreaterThanOrEqual(2);
      expect(
        contrast(luminance(...rgb(outline)), luminance(...rgb(background))),
      ).toBeGreaterThanOrEqual(3);
      await shot(page, `lista-fokus-1440-${theme}`);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await context.close();
    });
  }

  for (const theme of THEMES) {
    test(`axe bez naruszeń na liście i stronie wpisu ze zdjęciem (${theme})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: VIEWS[390] });
      const page = await context.newPage();

      for (const path of ["/news", `/news/${WITH_PHOTO.slug}`, `/news/${NO_PHOTO.slug}`]) {
        await open(page, theme, path);
        await page.addScriptTag({ content: axe.source });

        const violations = await page.evaluate(async () => {
          const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
          });

          return result.violations.map((violation) => ({
            id: violation.id,
            nodes: violation.nodes.map((node) => node.target.join(" ")),
          }));
        });

        expect(violations, path).toEqual([]);
      }

      await context.close();
    });
  }

  test("brak przewijania w poziomie przy 390 px i tekście 200 %", async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWS[390] });
    const page = await context.newPage();

    for (const path of ["/news", `/news/${WITH_PHOTO.slug}`, `/news/${NO_PHOTO.slug}`]) {
      await open(page, "light", path);
      await page.addStyleTag({ content: "html { font-size: 200%; }" });
      await page.waitForTimeout(300);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow, path).toBeLessThanOrEqual(0);
    }

    await context.close();
  });

  test("podgląd linku wpisu ma og:image tylko ze zdjęciem", async ({ page }) => {
    await page.goto(`/news/${NO_PHOTO.slug}`);
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
  });
});
