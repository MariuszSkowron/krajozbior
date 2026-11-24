import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { haversineKm } from "../src/features/catalog/domain/nearby";
import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// E9-3: the numbers on the profile. Needs a migrated, seeded database like the other specs that
// sign in; without it the spec is skipped. Visits are written straight in the disposable E2E
// database (parseE2eAdminDatabaseUrl) with chosen times, because a visit on site needs the
// device position; the cleanup removes the visits of the two demo accounts before and after.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const EXPLORER_A = "user@demo.krajozbior.local";
const EXPLORER_B = "user2@demo.krajozbior.local";
const THEME_COOKIE = "krajozbior-theme";

async function adminQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

async function cleanUp() {
  await adminQuery(
    `delete from public.visits where user_id in (select id from auth.users where email = any($1::text[]))`,
    [[EXPLORER_A, EXPLORER_B]],
  );
}

async function signedInPage(browser: Browser, email: string, width = 390): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await context.newPage();

  await page.goto("/login");

  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(email);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(my)?$/);
  // An account with no visit lands on the start page; these tests start on the profile.
  await page.goto("/my");

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

// The places of the demo collection, in the order of the collection.
const demoPlaces = () =>
  adminQuery<{ id: string; latitude: number; longitude: number }>(
    `select p.id, p.latitude, p.longitude
       from public.places p
       join public.collection_places cp on cp.place_id = p.id
       join public.collections c on c.id = cp.collection_id
      where c.slug = 'demo-mosty-i-zamki-nad-wisla'
      order by cp.position`,
  );

const addVisit = (email: string, placeId: string, kind: "on_site" | "past", at: string) =>
  kind === "on_site"
    ? adminQuery(
        `insert into public.visits (user_id, place_id, kind, client_visit_id, visited_at)
         values ((select id from auth.users where email = $1), $2, 'on_site', gen_random_uuid(), $3)`,
        [email, placeId, at],
      )
    : adminQuery(
        `insert into public.visits (user_id, place_id, kind, date_precision, visited_at)
         values ((select id from auth.users where email = $1), $2, 'past', 'unknown', $3)`,
        [email, placeId, at],
      );

test.describe("statistics on the profile", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("a new explorer sees zeros, the km caption says 'w linii prostej' and no tile of legendary cards", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A);
    const stats = page.getByTestId("profile-stats");

    await expect(stats.getByTestId("stat-places")).toHaveText("0");
    await expect(stats.getByTestId("stat-regions")).toHaveText("0");
    await expect(stats.getByTestId("stat-km")).toHaveText("0");
    await expect(stats.getByText("km w trasie (w linii prostej)")).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("legendarn");

    await page.context().close();
  });

  test("visits on two days and one from the past give places, regions and km; B sees none of it", async ({
    browser,
  }) => {
    const [bridge, gniew, malbork] = await demoPlaces();
    // Two visits on site on the first day, one on site the next day (no leg between days) and one
    // from the past that must not change the km.
    await addVisit(EXPLORER_A, bridge!.id, "on_site", "2026-07-10T08:00:00Z");
    await addVisit(EXPLORER_A, gniew!.id, "on_site", "2026-07-10T09:30:00Z");
    await addVisit(EXPLORER_A, malbork!.id, "past", "2026-07-10T09:45:00Z");
    await addVisit(EXPLORER_A, bridge!.id, "on_site", "2026-07-11T08:00:00Z");

    const expectedKm = haversineKm(
      bridge!.latitude,
      bridge!.longitude,
      gniew!.latitude,
      gniew!.longitude,
    );
    const pageA = await signedInPage(browser, EXPLORER_A);
    const stats = pageA.getByTestId("profile-stats");

    await expect(stats.getByTestId("stat-places")).toHaveText("3");
    await expect(stats.getByTestId("stat-regions")).toHaveText("1");
    await expect(stats.getByTestId("stat-km")).toHaveText(
      new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(expectedKm),
    );
    // A screen reader reads the label and the number together.
    await expect(stats.locator("dt", { hasText: "Odkryte miejsca" })).toBeVisible();

    const pageB = await signedInPage(browser, EXPLORER_B);

    await expect(pageB.getByTestId("stat-places")).toHaveText("0");
    await expect(pageB.getByTestId("stat-km")).toHaveText("0");

    await pageA.context().close();
    await pageB.context().close();
  });

  test("the tiles fit a phone and pass the accessibility check in both themes", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A, 320);

    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

    expect(await overflow()).toBe(0);
    await expectNoAccessibilityViolations(page);

    await page
      .context()
      .addCookies([{ name: THEME_COOKIE, value: "light", url: "http://127.0.0.1" }]);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/theme-light/);
    expect(await overflow()).toBe(0);
    await expectNoAccessibilityViolations(page);

    await page.context().close();
  });
});
