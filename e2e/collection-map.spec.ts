import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// E12-5: the map view of a collection (Leaflet on OpenStreetMap tiles, D-35). The tiles are
// always stubbed with a local image and every other request to the tile hosts is aborted, so
// neither CI nor an agent talks to the live OSM server. Needs a migrated, seeded database like
// the other specs that use the demo catalog; without it the spec is skipped. The cleanup
// deletes rows of the demo explorer straight in the database, so it runs only against the
// disposable E2E database (parseE2eAdminDatabaseUrl).
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const COLLECTION = "/collections/demo-mosty-i-zamki-nad-wisla";
const MAP = `${COLLECTION}?widok=mapa`;
const EXPLORER = "user@demo.krajozbior.local";
const THEME_COOKIE = "krajozbior-theme";
const TILE_HOST = "tile.openstreetmap.org";

// A 1x1 PNG, stretched by Leaflet to a tile.
const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

type Tiles = { stubbed: string[]; foreign: string[] };

// Stubs the one allowed tile host and aborts any other host of tiles (a., b., c. subdomains).
async function stubTiles(page: Page, answer: "image" | "abort" = "image"): Promise<Tiles> {
  const seen: Tiles = { stubbed: [], foreign: [] };

  await page.route(`https://${TILE_HOST}/**`, async (route) => {
    seen.stubbed.push(route.request().url());

    if (answer === "abort") {
      await route.abort();
    } else {
      await route.fulfill({ contentType: "image/png", body: TILE_PNG });
    }
  });
  await page.route(`https://*.${TILE_HOST}/**`, async (route) => {
    seen.foreign.push(route.request().url());
    await route.abort();
  });

  return seen;
}

// Waits until Leaflet has drawn at least one tile and every tile on the page has finished
// loading (the stubbed image or the aborted request), instead of waiting for network silence.
async function waitForTilesDrawn(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const tiles = Array.from(document.querySelectorAll<HTMLImageElement>("img.leaflet-tile"));
    return tiles.length > 0 && tiles.every((tile) => tile.complete);
  });
}

function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];

  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });

  return violations;
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

async function inBothThemes(page: Page, check: () => Promise<void>) {
  for (const theme of ["dark", "light"]) {
    await page
      .context()
      .addCookies([{ name: THEME_COOKIE, value: theme, url: "http://127.0.0.1" }]);
    await page.reload();
    await waitForHydration(page);
    await expect(page.locator("html")).toHaveClass(new RegExp(`theme-${theme}`));
    await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
    await check();
  }
}

async function signedInPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/login");

  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(email);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(my)?$/);

  return page;
}

async function adminQuery(sql: string, params: unknown[] = []) {
  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

async function cleanUp() {
  await adminQuery(
    `delete from public.visits where user_id in (select id from auth.users where email = $1)`,
    [EXPLORER],
  );
}

test.describe("the map view of a collection", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("the cards stay the default: no map, no tile request", async ({ page }) => {
    const tiles = await stubTiles(page);

    await page.goto(COLLECTION);
    await waitForHydration(page);

    const views = page.getByRole("navigation", { name: "Widok miejsc" });

    await expect(views.getByRole("link", { name: "Karty" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(".leaflet-container")).toHaveCount(0);
    expect(tiles.stubbed).toEqual([]);

    // The privacy note is there before the map is chosen, and tied to the switch.
    await expect(
      page.getByText(
        "Mapę dostarcza OpenStreetMap; po jej włączeniu serwer OpenStreetMap widzi adres IP urządzenia i oglądany obszar.",
      ),
    ).toBeVisible();
    // Tied to the "Mapa" link itself: screen readers rarely announce a description on <nav>.
    await expect(views.getByRole("link", { name: "Mapa" })).toHaveAccessibleDescription(
      /OpenStreetMap widzi adres IP/,
    );

    await views.getByRole("link", { name: "Mapa" }).click();
    await expect(page).toHaveURL(/\?widok=mapa$/);
    await expect(page.getByRole("region", { name: "Mapa miejsc kolekcji" })).toBeVisible();
  });

  test("a guest sees a marker of every place, the credit, and tiles only from the stub", async ({
    page,
  }) => {
    const tiles = await stubTiles(page);
    const csp = collectCspViolations(page);

    await page.goto(MAP);

    const region = page.getByRole("region", { name: "Mapa miejsc kolekcji" });

    await expect(region).toBeVisible();
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(3);
    await expect(
      region.getByRole("link", { name: "© OpenStreetMap contributors" }),
    ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
    await expect(region.getByRole("button", { name: "Przybliż" })).toBeVisible();
    await expect(region.getByRole("button", { name: "Oddal" })).toBeVisible();
    await expect.poll(() => tiles.stubbed.length).toBeGreaterThan(0);
    await waitForTilesDrawn(page);

    expect(tiles.foreign).toEqual([]);
    expect(tiles.stubbed.every((url) => url.startsWith(`https://${TILE_HOST}/`))).toBe(true);
    expect(csp).toEqual([]);
    // The list is below the map, and the guest has no state to show: no legend.
    await expect(page.getByText("Odwiedzone", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Most Tczewski/ }).first()).toBeVisible();
  });

  test("markers are reached with Tab and open the popup with Enter; the skip link goes to the list", async ({
    page,
  }) => {
    await stubTiles(page);
    await page.goto(MAP);
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(3);
    await waitForHydration(page);

    await page.getByRole("link", { name: "Pomiń mapę" }).focus();

    let marker = "";

    for (let step = 0; step < 15 && marker === ""; step += 1) {
      await page.keyboard.press("Tab");
      marker = await page.evaluate(() => {
        const active = document.activeElement;

        return active?.classList.contains("leaflet-marker-icon")
          ? (active.getAttribute("title") ?? "")
          : "";
      });
    }

    expect(marker).toMatch(/^.+$/);
    await page.keyboard.press("Enter");

    const popup = page.locator(".leaflet-popup");
    const link = popup.getByRole("link", { name: "Otwórz miejsce" });

    await expect(popup).toBeVisible();
    await expect(link).toHaveAttribute("href", /^\/places\/[0-9a-f-]{36}$/);
    // WCAG 2.4.3: the focus moves to the link that appeared ...
    await expect(link).toBeFocused();
    await expect(popup.getByRole("button", { name: "Zamknij okienko" })).toBeVisible();

    // ... and returns to the marker that opened the popup when it closes.
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(page.locator(`.leaflet-marker-icon[title="${marker}"]`)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(link).toBeFocused();
    await popup.getByRole("button", { name: "Zamknij okienko" }).click();
    await expect(popup).toHaveCount(0);
    await expect(page.locator(`.leaflet-marker-icon[title="${marker}"]`)).toBeFocused();

    // The skip link is hidden visually and appears when it has the focus (K-26).
    const skip = page.getByRole("link", { name: "Pomiń mapę" });

    expect((await skip.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    await skip.focus();
    expect((await skip.boundingBox())?.width ?? 0).toBeGreaterThan(20);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#lista-miejsc$/);
  });

  test("an explorer: a visited place has a different shape, a sign and a text (not only a colour)", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER);
    const tiles = await stubTiles(page);

    await adminQuery(
      `insert into public.visits (user_id, place_id, kind, date_precision)
       select u.id, p.id, 'past', 'unknown'
         from auth.users u, public.places p
        where u.email = $1 and p.name = 'Most Tczewski'`,
      [EXPLORER],
    );
    await page.goto(MAP);
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(3);

    await expect(
      page.locator('.leaflet-marker-icon[title="Most Tczewski — odwiedzone"]'),
    ).toHaveText("✓");
    await expect(
      page.locator('.leaflet-marker-icon[title="Zamek w Gniewie — do odkrycia"]'),
    ).toHaveText("2");
    await expect(page.getByText("Do odkrycia (numer miejsca)")).toBeVisible();

    // The filter works in the map view: only the markers of the filter stay.
    await page.getByRole("link", { name: "Odwiedzone (1)" }).click();
    await expect(page).toHaveURL(/widok=mapa&stan=odwiedzone$/);
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
    expect(tiles.foreign).toEqual([]);
    await page.context().close();
  });

  test("when the tiles do not load, the notice appears once and the markers and the credit stay", async ({
    page,
  }) => {
    await stubTiles(page, "abort");
    await page.goto(MAP);

    await expect(
      page.getByRole("status").filter({ hasText: "Mapa nie wczytała się w całości" }),
    ).toHaveCount(1);
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(3);
    await expect(page.getByRole("link", { name: "© OpenStreetMap contributors" })).toBeVisible();
  });

  test("no accessibility violations in both themes, also with a popup open", async ({ page }) => {
    await stubTiles(page);
    await page.goto(MAP);
    await waitForHydration(page);

    await inBothThemes(page, async () => {
      await expectNoAccessibilityViolations(page);
      await page.locator(".leaflet-marker-icon").first().click();
      await expect(page.locator(".leaflet-popup")).toBeVisible();
      await expectNoAccessibilityViolations(page);
    });
  });

  test("with reduced motion the map has no zoom, fade or marker animation", async ({ browser }) => {
    // Leaflet leaves lasting marks of its options in the DOM: `leaflet-fade-anim` on the
    // container (fadeAnimation), the `leaflet-proxy` element (only with zoomAnimation) and
    // `leaflet-zoom-hide` on the marker pane when markerZoomAnimation is off. Compare both
    // settings, so the test fails when the map ignores prefers-reduced-motion.
    const marks = async (reducedMotion: "reduce" | "no-preference") => {
      const context = await browser.newContext({ reducedMotion });
      const page = await context.newPage();

      await stubTiles(page);
      await page.goto(MAP);
      await expect(page.locator(".leaflet-marker-icon")).toHaveCount(3);

      const result = await page.evaluate(() => ({
        fade: document.querySelector(".leaflet-container")?.classList.contains("leaflet-fade-anim"),
        zoomAnimated: document.querySelectorAll(".leaflet-proxy").length,
        markerPaneHidden: document
          .querySelector(".leaflet-marker-pane")
          ?.classList.contains("leaflet-zoom-hide"),
      }));

      await context.close();

      return result;
    };

    const calm = await marks("reduce");
    const normal = await marks("no-preference");

    expect(normal.fade).toBe(true);
    expect(normal.zoomAnimated).toBeGreaterThan(0);
    expect(calm.fade).toBe(false);
    expect(calm.zoomAnimated).toBe(0);
    expect(calm.markerPaneHidden).toBe(true);
  });

  test("the filter does not change the map view: the tiles are the same with and without it (privacy)", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER);

    await adminQuery(
      `insert into public.visits (user_id, place_id, kind, date_precision)
       select u.id, p.id, 'past', 'unknown'
         from auth.users u, public.places p
        where u.email = $1 and p.name = 'Most Tczewski'`,
      [EXPLORER],
    );

    // A fresh page for each view, so the browser cache cannot hide a request.
    const tilesOf = async (url: string): Promise<string[]> => {
      const view = await page.context().newPage();
      const tiles = await stubTiles(view);

      await view.goto(url);
      await expect(view.locator(".leaflet-marker-icon").first()).toBeVisible();
      await expect.poll(() => tiles.stubbed.length).toBeGreaterThan(0);
      await waitForTilesDrawn(view);
      await view.close();

      return [...new Set(tiles.stubbed)].sort();
    };

    const all = await tilesOf(MAP);
    const visited = await tilesOf(`${MAP}&stan=odwiedzone`);

    expect(visited).toEqual(all);
    await page.context().close();
  });

  test("without JavaScript the list stays and the map says it needs it", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto(MAP);
    // Playwright's text engine skips <noscript>, so read its element directly.
    await expect(page.locator("noscript p")).toHaveText(/Mapa wymaga JavaScriptu/);
    await expect(page.getByText("Wczytuję mapę…")).toBeHidden();
    await expect(page.getByRole("link", { name: /Most Tczewski/ })).toBeVisible();
    await context.close();
  });
});
