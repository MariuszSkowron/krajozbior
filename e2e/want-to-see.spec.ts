import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// E2-S5, PR8: the "Chcę zobaczyć" list. The button on the place page, the list
// at /my/want-to-see with the date of saving, and the privacy of the list
// (explorer B does not see the list of A). Uses the demo collection and the two
// demo explorers; needs a migrated, seeded database like the other specs that
// sign in; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const EXPLORER_A = "user@demo.krajozbior.local";
const EXPLORER_B = "user2@demo.krajozbior.local";
// About 6 km north of the bridge: out of the radius.
const FAR = { latitude: 54.1468, longitude: 18.7919 };
// The bridge itself (radius 200 m).
const BRIDGE = { latitude: 54.0928, longitude: 18.7919 };

async function expectNoAccessibilityViolations(page: Page) {
  // Wejście sekcji (E3-2b) przygasza treść; axe liczy kontrast dopiero po końcu animacji.
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

const openContexts: BrowserContext[] = [];

async function signedInPage(
  browser: Browser,
  email: string,
  position: { latitude: number; longitude: number } | null = null,
): Promise<Page> {
  const context = await browser.newContext(
    position === null
      ? {}
      : { permissions: ["geolocation"], geolocation: { ...position, accuracy: 20 } },
  );
  // Closed after the test (also when it fails), not inside it: a close at the end of a long test
  // fell outside the time limit.
  openContexts.push(context);

  const page = await context.newPage();

  await page.goto("/login");

  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(email);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);

  return page;
}

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

// Visits this spec created (the client ids of its own requests), removed by id.
const createdVisitIds: string[] = [];

// Removes only what this spec creates: list entries of the two explorers for
// the places of the demo collection (no other spec saves those), and the visits
// recorded here, by their client id. Other specs share the demo accounts and may
// run in parallel, so nothing is deleted by user alone.
async function cleanUp() {
  await adminQuery(
    `delete from public.want_to_see_places
      where user_id in (select id from auth.users where email = any($1::text[]))
        and place_id in (
          select cp.place_id from public.collection_places cp
            join public.collections c on c.id = cp.collection_id
           where c.slug = $2)`,
    [[EXPLORER_A, EXPLORER_B], DEMO_SLUG],
  );

  if (createdVisitIds.length > 0) {
    await adminQuery(`delete from public.visits where client_visit_id = any($1::uuid[])`, [
      createdVisitIds.splice(0),
    ]);
  }
}

async function openBridge(page: Page) {
  await page.goto(`/collections/${DEMO_SLUG}`);
  // On a desktop screen a click on the card opens the panel (E12-4), so go by the address of the card.
  await page.goto(
    (await page.getByRole("link", { name: /Most Tczewski/ }).getAttribute("href")) ?? "",
  );
  await expect(page.getByRole("heading", { level: 1, name: "Most Tczewski" })).toBeVisible();
  // The button is a client component: wait until the page is interactive.
  await waitForHydration(page);
}

const wantButton = (page: Page) => page.getByRole("button", { name: "Chcę zobaczyć", exact: true });

test.describe("the want-to-see list", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((context) => context.close().catch(() => {})));
    await cleanUp();
  });

  test("a guest is sent to sign in and comes back to the place; the list needs a session", async ({
    page,
  }) => {
    await page.goto(`/collections/${DEMO_SLUG}`);
    await page.goto(
      (await page.getByRole("link", { name: /Most Tczewski/ }).getAttribute("href")) ?? "",
    );
    await expect(page).toHaveURL(/\/places\/[0-9a-f-]{36}$/);

    const placePath = new URL(page.url()).pathname;
    const placeId = placePath.split("/").pop() ?? "";

    await expect(page.getByRole("link", { name: /Zaloguj się, aby/ })).toHaveCount(1);
    await page
      .getByRole("link", {
        name: "Zaloguj się, aby potwierdzić wizytę lub zapisać na „Chcę zobaczyć”",
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/login\\?returnTo=${encodeURIComponent(placePath)}$`));

    // The route refuses a guest, and a foreign origin.
    const origin = new URL(page.url()).origin;

    expect(
      (await page.request.put(`/api/me/want-to-see/${placeId}`, { headers: { origin } })).status(),
    ).toBe(401);
    expect(
      (
        await page.request.put(`/api/me/want-to-see/${placeId}`, {
          headers: { origin: "https://evil.example" },
        })
      ).status(),
    ).toBe(403);

    await page.goto("/my/want-to-see");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fmy%2Fwant-to-see$/);
  });

  test("an explorer adds and removes a place; the list shows the date; B sees nothing", async ({
    browser,
  }) => {
    // Two sign-ins, five accessibility checks and the list round trip: about 25-30 s on a loaded
    // machine, so the default 30 s ended it at random. The sign-ins run side by side.
    test.setTimeout(90_000);
    const [a, b] = await Promise.all([
      signedInPage(browser, EXPLORER_A),
      signedInPage(browser, EXPLORER_B),
    ]);

    // The list opens without the demo place (other specs may keep entries of
    // their own places for the same accounts, so it is not asserted empty).
    await a.goto("/my/want-to-see");
    await expect(a.getByRole("heading", { level: 1, name: "Chcę zobaczyć" })).toBeVisible();
    await expect(a.getByRole("link", { name: /Most Tczewski/ })).toHaveCount(0);
    await expectNoAccessibilityViolations(a);

    await openBridge(a);
    await expectNoAccessibilityViolations(a);
    await wantButton(a).click();
    await expect(a.getByText("To miejsce jest na Twojej liście „Chcę zobaczyć”.")).toBeVisible();
    await expect(a.getByRole("button", { name: "Usuń z „Chcę zobaczyć”" })).toBeVisible();

    await a.goto("/my/want-to-see");
    await expect(a.getByRole("heading", { level: 1, name: "Chcę zobaczyć" })).toBeVisible();

    const item = a.getByRole("link", { name: /Most Tczewski/ });

    await expect(item).toContainText("Zapisano:");
    await expectNoAccessibilityViolations(a);

    // B has nothing, and B's own page of the same place offers the button.
    await b.goto("/my/want-to-see");
    await expect(b.getByRole("heading", { level: 1, name: "Chcę zobaczyć" })).toBeVisible();
    await expect(b.getByRole("link", { name: /Most Tczewski/ })).toHaveCount(0);

    // Removing from the place page empties the list again.
    await item.click();
    await waitForHydration(a);
    await a.getByRole("button", { name: "Usuń z „Chcę zobaczyć”" }).click();
    await expect(a.getByText("Usunięto z listy „Chcę zobaczyć”.")).toBeVisible();
    await a.goto("/my/want-to-see");
    await expect(a.getByRole("heading", { level: 1, name: "Chcę zobaczyć" })).toBeVisible();
    await expect(a.getByRole("link", { name: /Most Tczewski/ })).toHaveCount(0);
  });

  test("after a visit the place can still be removed from the list, and the list marks it (W1)", async ({
    browser,
  }) => {
    // Sign-in, a visit, a reload and an accessibility check: it ran 30.5 s on a loaded machine.
    test.setTimeout(90_000);
    const page = await signedInPage(browser, EXPLORER_A, BRIDGE);

    await openBridge(page);
    await wantButton(page).click();
    await expect(page.getByText("To miejsce jest na Twojej liście „Chcę zobaczyć”.")).toBeVisible();

    const request = page.waitForRequest(
      (candidate) => candidate.method() === "POST" && candidate.url().includes("/visits"),
    );

    await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    createdVisitIds.push(
      ((await request).postDataJSON() as { clientVisitId: string }).clientVisitId,
    );
    await expect(page.getByText("To miejsce jest w Twoim albumie.")).toBeVisible();

    // The page of the visited place still offers the removal.
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByText("Odwiedzone", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Potwierdzam wizytę" })).toHaveCount(0);
    await expectNoAccessibilityViolations(page);

    // The list marks the visited place.
    await page.goto("/my/want-to-see");
    await expect(page.getByRole("link", { name: /Most Tczewski/ })).toContainText("Odwiedzone");

    await page.getByRole("link", { name: /Most Tczewski/ }).click();
    await waitForHydration(page);
    await page.getByRole("button", { name: "Usuń z „Chcę zobaczyć”" }).click();
    await expect(page.getByText("Usunięto z listy „Chcę zobaczyć”.")).toBeVisible();
    await page.goto("/my/want-to-see");
    await expect(page.getByRole("link", { name: /Most Tczewski/ })).toHaveCount(0);
  });

  test("under the message 'out of range' the place can be put on the list (R-02)", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A, FAR);

    await openBridge(page);
    await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();

    const message = page.getByRole("status").filter({ hasText: /Jesteś .* km od miejsca\./ });

    await expect(message).toBeVisible();
    await wantButton(page).click();
    await expect(page.getByText("To miejsce jest na Twojej liście „Chcę zobaczyć”.")).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });

  test("the list fits a phone screen", async ({ browser }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await page.setViewportSize({ width: 320, height: 640 });
    await openBridge(page);
    await wantButton(page).click();
    await expect(page.getByRole("button", { name: "Usuń z „Chcę zobaczyć”" })).toBeVisible();
    await page.goto("/my/want-to-see");
    await expect(page.getByRole("link", { name: /Most Tczewski/ })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
  });
});
