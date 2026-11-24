import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// Golden path of a new explorer on a phone (390 px): after EVERY action the whole screen is checked
// for consistency (state, counters, messages), not only the element that was clicked. This spec is
// the acceptance criterion of the packages "first contact" and "after a visit" (docs plan
// 2026-11-23). Assertions are semantic (roles, states, numbers), not marketing copy, which changes.
// The accounts are created in the test with a code from the local e-mail outbox (like
// terms-acceptance.spec.ts). State assertions are soft, so one run lists every broken one; the
// steps that move through the flow are hard.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const OUTBOX = path.resolve(process.cwd(), ".data", "e2e-email-outbox");

const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const BRIDGE = { latitude: 54.0928, longitude: 18.7919 };
const PLACES_IN_COLLECTION = 3;
const PHONE = { width: 390, height: 844 };

const created: string[] = [];

const newAddress = (label: string) =>
  `gp-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;

const outboxFiles = async () =>
  (await readdir(OUTBOX).catch(() => [] as string[])).filter((name) => name.endsWith(".eml"));

// The six digits of the newest message to `email` that was not there before `known`.
async function codeFor(email: string, known: ReadonlySet<string>): Promise<string> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    for (const file of (await outboxFiles())
      .filter((name) => !known.has(name))
      .sort()
      .reverse()) {
      const raw = await readFile(path.join(OUTBOX, file), "utf8");

      if (!raw.includes(`To: ${email}`)) {
        continue;
      }

      for (const [, body] of raw.matchAll(
        /Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+?)(?=\r?\n--)/g,
      )) {
        const text = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
        const code = /\b(\d{6})\b/.exec(text)?.[1];

        if (code !== undefined) {
          return code;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("The sign-in code did not arrive in the outbox");
}

async function adminQuery(sql: string, params: unknown[] = []) {
  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    await client.query(sql, params);
  } finally {
    await client.end();
  }
}

// Removes only what this file created: visits and saved collections of its own accounts.
async function cleanUp() {
  const emails = created.splice(0);

  if (emails.length === 0) {
    return;
  }

  await adminQuery(
    `delete from public.visits where user_id in (select id from auth.users where email = any($1::text[]))`,
    [emails],
  );
  await adminQuery(
    `delete from public.saved_collections where user_id in (select id from auth.users where email = any($1::text[]))`,
    [emails],
  );
}

// A new account on a phone: the first sign-in with a code creates it, then the terms are accepted.
// The page is left on whatever screen the app shows after the acceptance.
async function newExplorer(
  browser: Browser,
  label: string,
  options: { geolocation: boolean },
): Promise<Page> {
  const context = await browser.newContext({
    viewport: PHONE,
    ...(options.geolocation
      ? { permissions: ["geolocation"], geolocation: { ...BRIDGE, accuracy: 20 } }
      : {}),
  });
  const page = await context.newPage();
  const email = newAddress(label);
  const known = new Set(await outboxFiles());

  created.push(email);
  await page.goto("/login");
  await page.locator("#code-request-email").fill(email);
  await page.getByRole("button", { name: "Wyślij kod" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("kod jest już w drodze");
  await page.locator("#code-verify-code").fill(await codeFor(email, known));
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  const gate = page.getByRole("heading", { level: 1, name: "Zanim zaczniesz" });

  await expect(gate).toBeVisible();
  await page.getByLabel(/Akceptuję Regulamin/).check();
  await page.getByRole("button", { name: "Akceptuję", exact: true }).click();
  await expect(gate).toHaveCount(0);
  await page.waitForLoadState("domcontentloaded");

  return page;
}

async function saveDemoCollection(page: Page) {
  await page.goto(`/collections/${DEMO_SLUG}`);
  await page.getByRole("button", { name: "Zapisuję kolekcję" }).click();
  await expect(page.getByRole("button", { name: "Usuń z zapisanych" })).toBeVisible();
  await waitForHydration(page);
}

async function openBridge(page: Page) {
  await page.goto(`/collections/${DEMO_SLUG}`);
  // The card is a link: go by its address, a click may open a panel on wide screens.
  await page.goto(
    (await page.getByRole("link", { name: /Most Tczewski/ }).getAttribute("href")) ?? "",
  );
  await expect(page.getByRole("heading", { level: 1, name: "Most Tczewski" })).toBeVisible();
  await waitForHydration(page);
}

const progressText = (scope: Locator | Page, visited: number) =>
  scope.getByText(new RegExp(`(^|\\s)${visited}/${PLACES_IN_COLLECTION} odwiedzone`));

// The element is fully inside the first screen of the phone, without scrolling.
async function isInFirstScreen(locator: Locator): Promise<boolean> {
  const box = await locator.boundingBox();

  return box !== null && box.y >= 0 && box.y + box.height <= PHONE.height;
}

async function expectPlaceScreenIsVisited(page: Page) {
  const main = page.getByRole("main");

  const photoState = page.locator("figure [data-state]");

  // The photo frame carries the state only when the place has a photo (the demo place has none).
  if ((await photoState.count()) > 0) {
    await expect.soft(photoState).toHaveAttribute("data-state", "visited");
  }
  await expect.soft(main.getByText("Odwiedzone", { exact: true }).first()).toBeVisible();
  await expect.soft(main.getByText("Do odkrycia")).toHaveCount(0);
  await expect.soft(progressText(main, 0)).toHaveCount(0);
  await expect.soft(progressText(main, 1).first()).toBeAttached();
}

test.describe("golden path of a new explorer on a phone", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.afterEach(cleanUp);

  test("new-explorer-first-screen", async ({ browser }) => {
    const page = await newExplorer(browser, "first", { geolocation: false });
    const main = page.getByRole("main");

    // A new account has neither collections nor visits: the profile is not the first screen.
    expect.soft(new URL(page.url()).pathname).not.toMatch(/^\/my(\/|$)/);

    // A block of nothing but zeros is not the first thing a new person sees.
    const figures = (await main.getByRole("definition").allTextContents()).map((text) =>
      text.trim(),
    );

    expect.soft(figures.length >= 3 && figures.every((text) => text === "0")).toBe(false);

    // A link to the collections is visible without scrolling.
    const links = main.getByRole("link", { name: /kolekcj/i });
    const inFirstScreen: boolean[] = [];

    for (const link of await links.all()) {
      inFirstScreen.push((await link.isVisible()) && (await isInFirstScreen(link)));
    }
    expect.soft(inFirstScreen.some(Boolean)).toBe(true);
  });

  test("visit-on-site-updates-screen", async ({ browser }) => {
    const page = await newExplorer(browser, "onsite", { geolocation: true });

    await saveDemoCollection(page);
    await openBridge(page);

    // Before the visit: the place is still to be discovered, with 0 of the collection.
    await expect(page.getByRole("main").getByText("Odwiedzone", { exact: true })).toHaveCount(0);
    await expect(progressText(page.getByRole("main"), 0).first()).toBeAttached();

    await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(page.getByRole("status").filter({ hasText: /w Twoim albumie/ })).toBeVisible();

    // Right after the action, without a manual reload, the whole place screen agrees.
    await expectPlaceScreenIsVisited(page);

    // The collection page: the tile of the place is visited, the progress is 1/N.
    await page.goto(`/collections/${DEMO_SLUG}`);
    await expect
      .soft(page.getByRole("link", { name: /Most Tczewski/ }))
      .toContainText(/Odwiedzone/);
    await expect.soft(progressText(page.getByRole("main"), 1).first()).toBeAttached();

    // Start: the progress is 1/N and the page does not say there is no saved collection.
    await page.goto("/");
    await expect.soft(progressText(page.getByRole("main"), 1).first()).toBeAttached();
    await expect.soft(page.getByText(/Nie masz jeszcze zapisanych kolekcji/)).toHaveCount(0);
  });

  test("past-visit-clean-state", async ({ browser }) => {
    const page = await newExplorer(browser, "past", { geolocation: false });

    await saveDemoCollection(page);
    await openBridge(page);

    // Without the permission the check on site is refused.
    await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /zgody na lokalizację/ })).toBeVisible();

    // The explorer takes the other way: a visit from the past, date unknown.
    await page.getByRole("button", { name: "Zaznaczam wcześniejszą wizytę" }).click();
    await page.getByRole("button", { name: "Zapisz wizytę z przeszłości" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Zapisano 1 wizytę/ })).toBeVisible();

    const main = page.getByRole("main");
    const marker = main.getByText(/^Z przeszłości/);

    // The refusal of the location is no longer on the screen, and "Sprawdź ponownie" is gone.
    await expect.soft(main.getByText(/zgody na lokalizację/)).toHaveCount(0);
    await expect.soft(main.getByRole("button", { name: "Sprawdź ponownie" })).toHaveCount(0);
    // Exactly one visit marker, and no "Chcę zobaczyć" for a visited place.
    await expect.soft(marker).toHaveCount(1);
    await expect.soft(main.getByRole("button", { name: /Chcę zobaczyć/ })).toHaveCount(0);

    const colorOfMarker = await marker
      .first()
      .evaluate((node) => getComputedStyle(node).color)
      .catch(() => null);

    await page.goto(`/collections/${DEMO_SLUG}`);

    const tileState = page
      .getByRole("link", { name: /Most Tczewski/ })
      .getByText(/^(Z przeszłości|Odwiedzone)$/);

    await expect.soft(tileState).toHaveCount(1);

    const colorOnTile = await tileState
      .first()
      .evaluate((node) => getComputedStyle(node).color)
      .catch(() => null);

    // The same state has the same color on the place page and on the collection tile.
    expect.soft(colorOfMarker).not.toBeNull();
    expect.soft(colorOfMarker).toBe(colorOnTile);
  });

  test("visited-without-saved-collection", async ({ browser }) => {
    const page = await newExplorer(browser, "unsaved", { geolocation: true });

    // The collection is NOT saved: the visit alone is enough.
    await openBridge(page);
    await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(page.getByRole("status").filter({ hasText: /w Twoim albumie/ })).toBeVisible();

    await page.goto("/");

    const main = page.getByRole("main");

    // The person has a visit: Start does not claim they have nothing...
    await expect.soft(main.getByText(/Nie masz jeszcze zapisanych kolekcji/)).toHaveCount(0);
    // ...and offers a button that leads on.
    await expect.soft(main.locator("a.button").first()).toBeVisible();
  });
});
