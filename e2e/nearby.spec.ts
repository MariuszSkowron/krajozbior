import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import axe from "axe-core";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// E12-3 / K-34: "Pokaż najbliższe" sorts the one section "Kolekcje do odkrycia" on the home page.
// The position is read only after a click (even when the permission is already granted), is
// counted in the browser and never leaves it: no request
// (RSC included), no console line. The tests write nothing to the database, but they rely on the
// seeded demo collection, so they run only against the disposable E2E database
// (parseE2eAdminDatabaseUrl) and are skipped without it.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const DEMO_TITLE = "Mosty i zamki nad Wisłą (demo)";
const EXPLORER_A = "user@demo.krajozbior.local";
const THEME_COOKIE = "krajozbior-theme";
// About 2 km from the centre of the demo places (Tczew, Gniew, Malbork). The digits are
// distinctive, so a leak in an address or a body is found by a plain substring search.
const NEAR = { latitude: 54.00123, longitude: 18.90456, accuracy: 25 };
const SECRETS = ["54.00123", "18.90456", "54.001", "18.904"];
const FAR = { latitude: 50.04132, longitude: 21.99901, accuracy: 25 };
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

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

async function inBothThemes(page: Page, check: (theme: string) => Promise<void>) {
  for (const theme of ["dark", "light"]) {
    await page
      .context()
      .addCookies([{ name: THEME_COOKIE, value: theme, url: "http://127.0.0.1" }]);
    await waitForHydration(page);
    await page.evaluate((value) => {
      document.documentElement.classList.remove("theme-dark", "theme-light");
      document.documentElement.classList.add(`theme-${value}`);
    }, theme);
    await check(theme);
  }
}

async function shot(page: Page, name: string) {
  if (SCREENSHOT_DIR === undefined) {
    return;
  }

  const size = page.viewportSize()?.width ?? 0;

  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page
    .locator("#odkrycie-title")
    .locator("..")
    .screenshot({
      path: join(SCREENSHOT_DIR, `${name}-${size}.png`),
    });
}

// Counts the calls of the geolocation API from the page: before a click there must be none.
async function watchGeolocation(page: Page) {
  await page.addInitScript(() => {
    const calls: unknown[][] = [];

    (window as unknown as { __geoCalls: unknown[][] }).__geoCalls = calls;

    if (!("geolocation" in navigator)) {
      return;
    }

    for (const method of ["getCurrentPosition", "watchPosition"] as const) {
      const original = navigator.geolocation[method].bind(navigator.geolocation);

      (navigator.geolocation as unknown as Record<string, unknown>)[method] = (
        ...args: unknown[]
      ) => {
        calls.push([method, args[2]]);

        return (original as (...a: unknown[]) => unknown)(...args);
      };
    }
  });
}

const geoCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __geoCalls: unknown[][] }).__geoCalls);

// Everything the page sends and logs, to be searched for the coordinates afterwards.
function recordTraffic(page: Page) {
  const traffic: string[] = [];
  const logs: string[] = [];

  page.on("request", (request) => {
    traffic.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`);
    traffic.push(JSON.stringify(request.headers()));
  });
  page.on("console", (message) => logs.push(message.text()));
  page.on("pageerror", (error) => logs.push(String(error)));

  return { traffic, logs };
}

async function contextAt(
  browser: Browser,
  position: { latitude: number; longitude: number; accuracy: number } | null,
  viewport = { width: 1280, height: 800 },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(
    position === null
      ? { viewport }
      : { viewport, geolocation: position, permissions: ["geolocation"] },
  );
  const page = await context.newPage();

  await watchGeolocation(page);

  return { context, page };
}

const section = (page: Page) => page.getByRole("region", { name: "Kolekcje do odkrycia" });

test.describe("'Pokaż najbliższe' in 'Kolekcje do odkrycia' on the home page", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeAll(() => {
    // Refuses to run against anything but the disposable E2E database.
    parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL);
  });

  test("does not read the position before a click, even with the permission granted; after it shows the demo collection with the distance, and nothing leaves the browser", async ({
    browser,
  }) => {
    const { context, page } = await contextAt(browser, NEAR);
    const { traffic, logs } = recordTraffic(page);

    await page.goto("/");
    await waitForHydration(page);
    await page.waitForTimeout(1500);

    const button = section(page).getByRole("button", { name: "Pokaż najbliższe" });

    await expect(button).toBeVisible();
    await expect(section(page).getByText("Położenie zostaje w tej przeglądarce.")).toBeVisible();
    // K-34: one list. Before a click the card is there in the order of the server, with no
    // distance. A plain string matches a substring of the accessible name, so no regular
    // expression is needed.
    await expect(section(page).getByRole("link", { name: DEMO_TITLE })).toBeVisible();
    await expect(section(page).getByText(/^\d+ km · /)).toHaveCount(0);
    expect(await geoCalls(page)).toEqual([]);
    await shot(page, "idle");
    await inBothThemes(page, async (theme) => {
      await expectNoAccessibilityViolations(page);
      await shot(page, `idle-${theme}`);
    });

    await button.click();

    const card = section(page).getByRole("link", { name: DEMO_TITLE });

    await expect(card).toHaveAttribute("href", `/collections/${DEMO_SLUG}`);
    await expect(section(page).getByRole("status")).toContainText("Kolekcje od najbliższej.");
    await expect(section(page).getByText(/^\d+ km · 3 miejsca · /)).toBeVisible();
    // E12-S4: the demo collection was published a moment ago and lies within 50 km.
    await expect(section(page).getByText("Nowa w okolicy", { exact: true })).toBeVisible();
    await expect(section(page).getByRole("button", { name: "Sprawdź ponownie" })).toBeVisible();

    const calls = await geoCalls(page);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      "getCurrentPosition",
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    ]);
    await inBothThemes(page, async (theme) => {
      await expectNoAccessibilityViolations(page);
      await shot(page, `found-${theme}`);
    });

    // Nothing the page sent (address, body, headers; RSC requests included) or logged holds the
    // position. Whether the click made a request is not asserted: a card link may be prefetched
    // by Next, and that is harmless as long as no coordinate is in it.
    for (const secret of SECRETS) {
      expect(traffic.join("\n")).not.toContain(secret);
      expect(logs.join("\n")).not.toContain(secret);
    }
    expect(page.url()).not.toMatch(/54\.|18\.9|\?/);
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).toBe(
      "[{},{}]",
    );

    await context.close();
  });

  test("shows the same on a phone and keeps its content inside the screen", async ({ browser }) => {
    const { context, page } = await contextAt(browser, NEAR, { width: 390, height: 844 });

    await page.goto("/");
    await waitForHydration(page);
    await section(page).getByRole("button", { name: "Pokaż najbliższe" }).click();
    await expect(section(page).getByRole("status")).toContainText("Kolekcje od najbliższej.");
    await shot(page, "found");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await context.close();
  });

  test("far from every collection the list is still whole, with the distance and no 'Nowa w okolicy' mark", async ({
    browser,
  }) => {
    const { context, page } = await contextAt(browser, FAR);

    await page.goto("/");
    await waitForHydration(page);
    await section(page).getByRole("button", { name: "Pokaż najbliższe" }).click();
    await expect(section(page).getByRole("status")).toHaveText("Kolekcje od najbliższej.");
    await expect(
      section(page).getByRole("link", { name: "Wszystkie kolekcje", exact: true }),
    ).toHaveAttribute("href", "/search");
    await expect(section(page).getByRole("link", { name: DEMO_TITLE })).toBeVisible();
    await expect(section(page).getByText(/^\d{3,} km · 3 miejsca · /)).toBeVisible();
    await expect(section(page).getByText("Nowa w okolicy", { exact: true })).toHaveCount(0);
    await shot(page, "far");
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));
    await context.close();
  });

  test("notes that a coarse reading makes the distances approximate", async ({ browser }) => {
    const { context, page } = await contextAt(browser, { ...NEAR, accuracy: 9000 });

    await page.goto("/");
    await waitForHydration(page);
    await section(page).getByRole("button", { name: "Pokaż najbliższe" }).click();
    await expect(section(page).getByRole("status")).toContainText(
      "Położenie jest niedokładne, więc odległości są przybliżone.",
    );
    await shot(page, "coarse");
    await context.close();
  });

  test("explains a refused permission, then lets the explorer try again", async ({ browser }) => {
    // No permission granted: the headless browser refuses at once.
    const { context, page } = await contextAt(browser, null);
    const { traffic, logs } = recordTraffic(page);

    await page.goto("/");
    await waitForHydration(page);
    await section(page).getByRole("button", { name: "Pokaż najbliższe" }).click();
    await expect(section(page).getByRole("status")).toHaveText(
      "Nie mamy zgody na lokalizację. Zezwól na nią w ustawieniach przeglądarki.",
    );
    await expect(
      section(page).getByRole("link", { name: "Wszystkie kolekcje", exact: true }),
    ).toBeVisible();
    await expect(section(page).getByRole("button", { name: "Sprawdź ponownie" })).toBeVisible();
    await shot(page, "denied");
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));

    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(NEAR);
    await section(page).getByRole("button", { name: "Sprawdź ponownie" }).click();
    await expect(section(page).getByRole("status")).toContainText("Kolekcje od najbliższej.");
    for (const secret of SECRETS) {
      expect(traffic.join("\n")).not.toContain(secret);
      expect(logs.join("\n")).not.toContain(secret);
    }
    await context.close();
  });

  test("offers only the link when the browser has no geolocation", async ({ browser }) => {
    const { context, page } = await contextAt(browser, null);

    await page.addInitScript(() => {
      Reflect.deleteProperty(Navigator.prototype, "geolocation");
    });
    await page.goto("/");
    await waitForHydration(page);
    await expect(
      section(page).getByText("Ta przeglądarka nie obsługuje lokalizacji."),
    ).toBeVisible();
    await expect(
      section(page).getByRole("link", { name: "Wszystkie kolekcje", exact: true }),
    ).toBeVisible();
    await expect(section(page).getByRole("button")).toHaveCount(0);
    await shot(page, "unsupported");
    await context.close();
  });

  test("an explorer signed in sees the section too, and every link of the page works", async ({
    browser,
  }) => {
    const { context, page } = await contextAt(browser, NEAR);

    await page.goto("/login");

    await page.getByText("Logowanie hasłem").click();

    const form = page.locator("form", { has: page.getByLabel("Hasło") });

    await form.getByLabel("E-mail").fill(EXPLORER_A);
    await form.getByLabel("Hasło").fill(password ?? "");
    await form.getByRole("button", { name: "Zaloguj się" }).click();
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(my)?$/);
    await page.goto("/");
    await waitForHydration(page);
    await section(page).getByRole("button", { name: "Pokaż najbliższe" }).click();
    await expect(section(page).getByRole("status")).toContainText("Kolekcje od najbliższej.");
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));

    const targets = await page.evaluate(() =>
      [...document.querySelectorAll("main a[href], main form[action]")]
        .map((element) => element.getAttribute("href") ?? element.getAttribute("action"))
        .filter((value): value is string => value !== null && value.startsWith("/")),
    );

    expect(targets.length).toBeGreaterThan(0);
    for (const target of new Set(targets)) {
      expect((await page.request.get(target)).status(), `GET ${target}`).toBe(200);
    }
    await context.close();
  });
});
