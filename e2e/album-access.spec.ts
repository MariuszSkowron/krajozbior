import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// E2, PR6: saving a collection and "Moje kolekcje" with two explorers (demo
// accounts user@ and user2@). Needs a migrated, seeded database like the other
// specs that sign in; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const DEMO_TITLE = "Mosty i zamki nad Wisłą (demo)";
const EXPLORER_A = "user@demo.krajozbior.local";
const EXPLORER_B = "user2@demo.krajozbior.local";

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

async function logIn(page: Page, email: string) {
  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(email);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
}

async function signedInPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/login");
  await logIn(page, email);
  await expect(page).toHaveURL(/\/my$/);

  return page;
}

// The saves of the two demo explorers are removed straight in the database
// (admin connection, like the other specs), before and after each test, so a
// failed run leaves no trace and the next one starts from "no saves".
async function removeSaves() {
  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    await client.query(
      `delete from public.saved_collections
        where user_id in (select id from auth.users where email = any($1::text[]))`,
      [[EXPLORER_A, EXPLORER_B]],
    );
  } finally {
    await client.end();
  }
}

async function demoId(): Promise<string> {
  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    const rows = await client.query("select id from public.collections where slug = $1", [
      DEMO_SLUG,
    ]);

    return String(rows.rows[0].id);
  } finally {
    await client.end();
  }
}

test.describe("saved collections", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(removeSaves);
  test.afterEach(removeSaves);

  test("a guest is sent to sign in and comes back to the collection, then saves it", async ({
    page,
  }) => {
    await page.goto(`/collections/${DEMO_SLUG}`);
    await page.getByRole("link", { name: "Zapisz kolekcję" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/login\\?returnTo=${encodeURIComponent(`/collections/${DEMO_SLUG}`)}$`),
    );
    await logIn(page, EXPLORER_A);
    await expect(page).toHaveURL(new RegExp(`/collections/${DEMO_SLUG}$`));
    await expect(page.getByRole("heading", { level: 1, name: DEMO_TITLE })).toBeVisible();

    await page.getByRole("button", { name: "Zapisz kolekcję" }).click();
    await expect(page.getByRole("button", { name: "Usuń z zapisanych" })).toBeVisible();
    await expect(page.getByText("Ta kolekcja jest w Twoich zapisanych.")).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await page.getByRole("button", { name: "Usuń z zapisanych" }).click();
    await expect(page.getByRole("button", { name: "Zapisz kolekcję" })).toBeVisible();
    // The page has more than one live region (the list of places has its own, empty one).
    await expect(page.getByRole("status").filter({ hasText: "Usunięto z zapisanych." })).toHaveText(
      "Usunięto z zapisanych.",
    );
  });

  test("explorer A sees the saved collection with 0/3, explorer B does not and cannot remove it", async ({
    browser,
  }) => {
    const pageA = await signedInPage(browser, EXPLORER_A);
    const pageB = await signedInPage(browser, EXPLORER_B);

    // Before saving: the empty state, with a way out.
    await pageA.goto("/my/collections");
    await expect(
      pageA.getByRole("heading", { level: 2, name: "Nie masz jeszcze zapisanych kolekcji" }),
    ).toBeVisible();
    await expect(pageA.getByRole("link", { name: "Zobacz kolekcje" })).toBeVisible();
    await expectNoAccessibilityViolations(pageA);

    await pageA.goto(`/collections/${DEMO_SLUG}`);
    await pageA.getByRole("button", { name: "Zapisz kolekcję" }).click();
    await expect(pageA.getByRole("button", { name: "Usuń z zapisanych" })).toBeVisible();

    await pageA.goto("/my/collections");
    await expect(pageA.getByRole("heading", { level: 1, name: "Moje kolekcje" })).toBeVisible();

    const itemA = pageA.getByRole("link", { name: DEMO_TITLE });

    await expect(itemA).toBeVisible();
    await expect(itemA).toContainText("0/3 odwiedzone");
    await expect(
      pageA.getByRole("progressbar", { name: `Postęp w kolekcji ${DEMO_TITLE}` }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(pageA);

    // Explorer B sees none of it, on the list or on the collection page.
    await pageB.goto("/my/collections");
    await expect(
      pageB.getByRole("heading", { level: 2, name: "Nie masz jeszcze zapisanych kolekcji" }),
    ).toBeVisible();
    await expect(pageB.getByRole("link", { name: DEMO_TITLE })).toHaveCount(0);
    await pageB.goto(`/collections/${DEMO_SLUG}`);
    await expect(pageB.getByRole("button", { name: "Zapisz kolekcję" })).toBeVisible();

    // B's delete of A's save changes nothing: it is silent and A still has it.
    const deleted = await pageB.request.delete(`/api/me/saved-collections/${await demoId()}`, {
      headers: { origin: new URL(pageB.url()).origin },
    });

    expect(deleted.status()).toBe(200);
    await pageA.reload();
    await expect(pageA.getByRole("link", { name: DEMO_TITLE })).toBeVisible();

    await pageA.context().close();
    await pageB.context().close();
  });

  test("the list fits a phone screen", async ({ browser }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/collections/${DEMO_SLUG}`);
    await page.getByRole("button", { name: "Zapisz kolekcję" }).click();
    await expect(page.getByRole("button", { name: "Usuń z zapisanych" })).toBeVisible();
    await page.goto("/my/collections");
    await expect(page.getByRole("heading", { level: 1, name: "Moje kolekcje" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
    await page.context().close();
  });
});
