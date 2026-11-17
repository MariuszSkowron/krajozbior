import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

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

async function expectNoAccessibilityViolations(page: Page) {
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

async function signedInPage(browser: Browser, email: string, geolocation = false): Promise<Page> {
  const context = await browser.newContext(
    geolocation ? { permissions: ["geolocation"], geolocation: { ...FAR, accuracy: 20 } } : {},
  );
  const page = await context.newPage();

  await page.goto("/login");

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(email);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);

  return page;
}

async function adminQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });

  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

async function cleanUp() {
  await adminQuery(
    `delete from public.want_to_see_places where user_id in (select id from auth.users where email = any($1::text[]))`,
    [[EXPLORER_A, EXPLORER_B]],
  );
}

async function openBridge(page: Page) {
  await page.goto(`/collections/${DEMO_SLUG}`);
  await page.getByRole("link", { name: /Most Tczewski/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Most Tczewski" })).toBeVisible();
  // The button is a client component: wait until the page is interactive.
  await page.waitForLoadState("networkidle");
}

const wantButton = (page: Page) => page.getByRole("button", { name: "Chcę zobaczyć", exact: true });

test.describe("the want-to-see list", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("a guest is sent to sign in and comes back to the place; the list needs a session", async ({
    page,
  }) => {
    await page.goto(`/collections/${DEMO_SLUG}`);
    await page.getByRole("link", { name: /Most Tczewski/ }).click();
    await expect(page).toHaveURL(/\/places\/[0-9a-f-]{36}$/);

    const placePath = new URL(page.url()).pathname;
    const placeId = placePath.split("/").pop() ?? "";

    await page.getByRole("link", { name: "Zaloguj się, aby zapisać na Chcę zobaczyć" }).click();
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
    const a = await signedInPage(browser, EXPLORER_A);
    const b = await signedInPage(browser, EXPLORER_B);

    // An empty list is a calm state, not an error.
    await a.goto("/my/want-to-see");
    await expect(
      a.getByRole("heading", { level: 2, name: "Nie masz jeszcze zapisanych miejsc" }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(a);

    await openBridge(a);
    await expectNoAccessibilityViolations(a);
    await wantButton(a).click();
    await expect(a.getByText("To miejsce jest na Twojej liście „Chcę zobaczyć”.")).toBeVisible();
    await expect(a.getByRole("button", { name: "Usuń z Chcę zobaczyć" })).toBeVisible();

    await a.goto("/my/want-to-see");
    await expect(a.getByRole("heading", { level: 1, name: "Chcę zobaczyć" })).toBeVisible();

    const item = a.getByRole("link", { name: /Most Tczewski/ });

    await expect(item).toContainText("Zapisano:");
    await expectNoAccessibilityViolations(a);

    // B has nothing, and B's own page of the same place offers the button.
    await b.goto("/my/want-to-see");
    await expect(
      b.getByRole("heading", { level: 2, name: "Nie masz jeszcze zapisanych miejsc" }),
    ).toBeVisible();
    await expect(b.getByRole("link", { name: /Most Tczewski/ })).toHaveCount(0);

    // Removing from the place page empties the list again.
    await item.click();
    await a.waitForLoadState("networkidle");
    await a.getByRole("button", { name: "Usuń z Chcę zobaczyć" }).click();
    await expect(a.getByText("Usunięto z listy „Chcę zobaczyć”.")).toBeVisible();
    await a.goto("/my/want-to-see");
    await expect(
      a.getByRole("heading", { level: 2, name: "Nie masz jeszcze zapisanych miejsc" }),
    ).toBeVisible();

    await a.context().close();
    await b.context().close();
  });

  test("under the message 'out of range' the place can be put on the list (R-02)", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A, true);

    await openBridge(page);
    await page.getByRole("button", { name: "Potwierdź wizytę" }).click();

    const message = page.getByRole("status").filter({ hasText: /Jesteś .* km od miejsca\./ });

    await expect(message).toBeVisible();
    await wantButton(page).click();
    await expect(page.getByText("To miejsce jest na Twojej liście „Chcę zobaczyć”.")).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await page.context().close();
  });

  test("the list fits a phone screen", async ({ browser }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await page.setViewportSize({ width: 320, height: 640 });
    await openBridge(page);
    await wantButton(page).click();
    await expect(page.getByRole("button", { name: "Usuń z Chcę zobaczyć" })).toBeVisible();
    await page.goto("/my/want-to-see");
    await expect(page.getByRole("link", { name: /Most Tczewski/ })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
    await page.context().close();
  });
});
