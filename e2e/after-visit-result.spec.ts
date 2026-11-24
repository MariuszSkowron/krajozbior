import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// Po wizycie (na miejscu i z przeszłości) wynik jest widoczny bez ręcznego przewijania: w oknie
// telefonu i nad przypiętym paskiem u dołu. Kolekcja ukończona jest spójnie opisana na każdej
// ścieżce (komunikat po wizycie, strona kolekcji, Start). Potrzebuje zmigrowanej, zasianej bazy.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const EXPLORER_A = "user@demo.krajozbior.local";
const EXPLORER_B = "user2@demo.krajozbior.local";
const BRIDGE = { latitude: 54.0928, longitude: 18.7919 };
const VIEWPORTS = [
  { width: 390, height: 667 },
  { width: 390, height: 844 },
] as const;

async function signedInPage(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport,
    permissions: ["geolocation"],
    geolocation: { ...BRIDGE, accuracy: 20 },
  });
  const page = await context.newPage();

  await page.goto("/login");
  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(EXPLORER_A);
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
    await client.query(sql, params);
  } finally {
    await client.end();
  }
}

async function cleanUp() {
  const users = [[EXPLORER_A, EXPLORER_B]];

  await adminQuery(
    `delete from public.visits where user_id in (select id from auth.users where email = any($1::text[]))`,
    users,
  );
  await adminQuery(
    `delete from public.want_to_see_places where user_id in (select id from auth.users where email = any($1::text[]))`,
    users,
  );
  await adminQuery(
    `delete from public.saved_collections where user_id in (select id from auth.users where email = any($1::text[]))`,
    users,
  );
}

async function saveCollection(page: Page) {
  await page.goto(`/collections/${DEMO_SLUG}`);
  await page.getByRole("button", { name: "Zapisuję kolekcję" }).click();
  await expect(page.getByRole("button", { name: "Usuń z zapisanych" })).toBeVisible();
  await waitForHydration(page);
}

async function openBridge(page: Page) {
  await page.goto(`/collections/${DEMO_SLUG}`);
  await page.goto(
    (await page.getByRole("link", { name: /Most Tczewski/ }).getAttribute("href")) ?? "",
  );
  await expect(page.getByRole("heading", { level: 1, name: "Most Tczewski" })).toBeVisible();
  await waitForHydration(page);
}

// Malbork and Gniew marked as visits from the past on the collection page: only the bridge is left.
async function markOthers(page: Page) {
  await page.goto(`/collections/${DEMO_SLUG}`);
  await page.getByRole("button", { name: "Zaznacz odwiedzone" }).click();
  await page.getByRole("checkbox", { name: /Zamek w Malborku/ }).check();
  await page.getByRole("checkbox", { name: /Zamek w Gniewie/ }).check();
  await page.getByRole("button", { name: "Zapisz wizyty z przeszłości" }).click();
  await expect(page.getByText("2/3 odwiedzone")).toBeVisible();
}

async function savePastVisitOfBridge(page: Page) {
  await page.getByRole("button", { name: "Zaznaczam wcześniejszą wizytę" }).click();
  await page.getByRole("radio", { name: "Rok" }).check();
  await page.getByRole("textbox", { name: "Rok", exact: true }).fill("2018");
  await page.getByRole("button", { name: "Zapisz wizytę z przeszłości" }).click();
}

// The button is disabled until the page is hydrated, so one click after it is enabled is enough.
async function confirmOnSite(page: Page) {
  const button = page.getByRole("button", { name: "Potwierdzam wizytę" });

  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
  await expect(button).toHaveCount(0, { timeout: 15_000 });
}

// The element lies whole in the window and above the pinned bar at the bottom (the page scrolls
// smoothly, so the check waits for the end of the movement).
async function expectInWindowAboveBar(page: Page, element: Locator) {
  await expect
    .poll(
      async () => {
        const box = await element.boundingBox();
        const bar = await page.locator("[data-pinned-action]").boundingBox();
        const height = page.viewportSize()!.height;

        if (box === null) {
          return "no box";
        }

        const barTop = bar === null ? height : bar.y;

        return box.y >= 0 && box.y + box.height <= barTop
          ? "visible"
          : `y=${box.y} bottom=${box.y + box.height} barTop=${barTop}`;
      },
      { timeout: 10_000 },
    )
    .toBe("visible");
}

test.describe("the result of a visit is visible", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("scripts of the page delayed: the buttons stay disabled until hydration, then one click saves the visit", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, VIEWPORTS[0]);

    await saveCollection(page);

    // The scripts of the page come late (a slow phone in the field); released by hand below.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));

    await page.route("**/_next/static/**/*.js", async (route) => {
      await gate;
      await route.continue();
    });

    await page.goto(`/collections/${DEMO_SLUG}`, { waitUntil: "domcontentloaded" });
    await page.goto(
      (await page.getByRole("link", { name: /Most Tczewski/ }).getAttribute("href")) ?? "",
      { waitUntil: "domcontentloaded" },
    );

    const confirm = page.getByRole("button", { name: "Potwierdzam wizytę" });

    await expect(confirm).toBeVisible();
    await expect(confirm).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Zaznaczam wcześniejszą wizytę" }),
    ).toBeDisabled();

    release();
    await expect(confirm).toBeEnabled({ timeout: 30_000 });
    await confirm.click();
    await expect(
      page.getByRole("status").filter({ hasText: "Most Tczewski jest w Twoim albumie." }),
    ).toBeVisible({ timeout: 15_000 });
    await page.context().close();
  });

  // The sections of the page come in with a short animation (opacity, 0.8 s). A tap on the pinned
  // button in that time must reach the button, not the section below it. The animations are
  // stopped in the middle, so the moment of the tap does not depend on the speed of the machine.
  test("phone: a tap on the pinned button while the page is still coming in saves the visit", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, VIEWPORTS[0]);

    await saveCollection(page);
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        for (const animation of document.getAnimations()) {
          animation.pause();
          animation.currentTime = 400;
        }
      });
    });
    await openBridge(page);
    await confirmOnSite(page);
    await expect(
      page.getByRole("status").filter({ hasText: "Most Tczewski jest w Twoim albumie." }),
    ).toBeVisible();
    await page.context().close();
  });

  test("after the visit the focus stays on the clicked element, not on the message", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, VIEWPORTS[1]);

    await saveCollection(page);
    await openBridge(page);

    // On the list before the visit, so the button stays under the message after it.
    const want = page.getByRole("button", { name: "Chcę zobaczyć" });

    await expect(want).toBeEnabled();
    await want.click();
    await expect(page.getByRole("button", { name: /Usuń z „Chcę zobaczyć”/ })).toBeVisible();
    await confirmOnSite(page);

    const message = page
      .getByRole("status")
      .filter({ hasText: "Most Tczewski jest w Twoim albumie." });

    await expect(message).toBeFocused();

    // Another render of the component (the list changes) must not pull the focus back.
    await page.getByRole("button", { name: /Usuń z „Chcę zobaczyć”/ }).click();
    await expect(page.getByRole("button", { name: "Chcę zobaczyć" })).toBeVisible();
    await expect(message).not.toBeFocused();
    await page.context().close();
  });

  for (const viewport of VIEWPORTS) {
    const size = `${viewport.width}x${viewport.height}`;

    test(`on site, ${size}: the message and "Co dalej" are in the window above the bar`, async ({
      browser,
    }) => {
      const page = await signedInPage(browser, viewport);

      await saveCollection(page);
      await openBridge(page);
      await confirmOnSite(page);

      const message = page
        .getByRole("status")
        .filter({ hasText: "Most Tczewski jest w Twoim albumie." });
      const next = page.getByRole("list", { name: "Co dalej" });

      await expect(next.getByRole("link", { name: "Zamek w Malborku" })).toBeVisible();
      await expectInWindowAboveBar(page, message);
      await expectInWindowAboveBar(page, next);
      await expect(message).toBeFocused();
      await page.context().close();
    });

    test(`from the past, ${size}: the message and "Co dalej" are in the window above the bar`, async ({
      browser,
    }) => {
      const page = await signedInPage(browser, viewport);

      await saveCollection(page);
      await openBridge(page);
      await savePastVisitOfBridge(page);

      const message = page
        .getByRole("status")
        .filter({ hasText: "Zapisano 1 wizytę z przeszłości." });
      const next = page.getByRole("list", { name: "Co dalej" });

      await expect(next.getByRole("link", { name: "Zamek w Malborku" })).toBeVisible();
      await expectInWindowAboveBar(page, message);
      await expectInWindowAboveBar(page, next);
      await expect(message).toBeFocused();
      await page.context().close();
    });
  }

  test("a collection completed on site: the same message, the state on the collection page and on Start", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, VIEWPORTS[0]);

    await saveCollection(page);
    await markOthers(page);
    await openBridge(page);
    await confirmOnSite(page);

    const next = page.getByRole("list", { name: "Co dalej" });

    await expect(next).toContainText("jest kompletna: masz wszystkie jej miejsca.");
    await expect(next).not.toContainText("Najbliższe nieodwiedzone");
    await expectCompleteEverywhere(page);
    await page.context().close();
  });

  test("a collection completed by a visit from the past: the same message, the same state", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, VIEWPORTS[0]);

    await saveCollection(page);
    await markOthers(page);
    await openBridge(page);
    await savePastVisitOfBridge(page);

    const next = page.getByRole("list", { name: "Co dalej" });

    await expect(next).toContainText("jest kompletna: masz wszystkie jej miejsca.");
    await expect(next).not.toContainText("Najbliższe nieodwiedzone");
    await expectCompleteEverywhere(page);
    await page.context().close();
  });
});

async function expectCompleteEverywhere(page: Page) {
  await page.goto(`/collections/${DEMO_SLUG}`);
  await expect(page.getByText("3/3 odwiedzone")).toBeVisible();
  await expect(page.getByText("Kolekcja kompletna", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByText(/kolekcja kompletna/i).first()).toBeAttached();
}
