import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// E8-1a: private collections of an explorer with two explorers (demo accounts user@ and user2@):
// creating a collection, adding a place of the catalog from the search on its page, privacy for
// another explorer and a guest, and the accessibility of both screens in both themes. Needs a
// migrated, seeded database like the other specs that sign in; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const EXPLORER_A = "user@demo.krajozbior.local";
const EXPLORER_B = "user2@demo.krajozbior.local";
const THEME_COOKIE = "krajozbior-theme";
const OWN_TITLE = "Wieże widokowe (test)";
const PLACE = "Most Tczewski";

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

// The collections of the two explorers are removed straight in the database (admin connection)
// before and after each test, so a failed run leaves no trace.
const cleanUp = () =>
  adminQuery(
    `delete from public.user_collections
      where owner_user_id in (select id from auth.users where email = any($1::text[]))`,
    [[EXPLORER_A, EXPLORER_B]],
  );

async function expectNoAccessibilityViolations(page: Page) {
  // The entrance of a section dims the content; axe counts the contrast only after the animation.
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

// Checks the page in both themes without waiting for the network: the class of the theme is
// switched in place, and the check starts only once the page shows the expected state.
async function inBothThemes(page: Page, check: () => Promise<void>) {
  for (const theme of ["dark", "light"]) {
    await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url: page.url() }]);
    await page.evaluate((value) => {
      document.documentElement.classList.remove("theme-dark", "theme-light");
      document.documentElement.classList.add(`theme-${value}`);
    }, theme);
    await check();
  }
}

async function signedInPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
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

async function createCollection(page: Page): Promise<string> {
  await page.goto("/my/collections");
  await page.getByRole("link", { name: "Nowa kolekcja" }).click();
  await expect(page).toHaveURL(/\/my\/collections\/own\/new$/);
  await page.getByLabel("Nazwa").fill(OWN_TITLE);
  await page.getByLabel("Krótki opis").fill("Moje ulubione widoki.");
  await page.getByLabel("Region").selectOption({ label: "Pomorskie" });
  await page.getByRole("button", { name: "Utwórz kolekcję" }).click();
  await expect(page).toHaveURL(/\/my\/collections\/own\/[0-9a-f-]{36}$/);

  return page.url().split("/").at(-1) ?? "";
}

test.describe("own collections", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("an explorer creates a collection, adds a place from the catalog and sees the progress", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await page.goto("/my/collections");
    await expect(
      page.getByRole("heading", { level: 2, name: "Moje własne kolekcje (0)" }),
    ).toBeVisible();
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));

    const id = await createCollection(page);

    await expect(page.getByRole("heading", { level: 1, name: OWN_TITLE })).toBeVisible();
    await expect(page.getByText("Postęp 0/0")).toHaveCount(0);
    await expect(page.getByText("Ta kolekcja nie ma jeszcze miejsc.")).toBeVisible();

    await page.getByLabel("Nazwa albo adres miejsca").fill("Tczew");
    await page.getByRole("button", { name: "Szukaj", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/my/collections/own/${id}\\?q=Tczew$`));
    await page.getByRole("button", { name: `Dodaj do kolekcji: ${PLACE}` }).click();
    await expect(page.getByRole("status").filter({ hasText: "Dodano do kolekcji." })).toHaveText(
      "Dodano do kolekcji.",
    );
    await expect(page.getByRole("heading", { level: 2, name: "Miejsca (1)" })).toBeVisible();
    await expect(page.getByText("Postęp 0/1")).toBeVisible();
    // The place is in the collection now: the hit offers no second add.
    await expect(page.getByText("Już w kolekcji")).toBeVisible();
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));

    await page.goto("/my/collections");
    await expect(
      page.getByRole("heading", { level: 2, name: "Moje własne kolekcje (1)" }),
    ).toBeVisible();

    const card = page.getByRole("link", { name: OWN_TITLE });

    await expect(card).toContainText("0/1 odwiedzone");
    await expect(page.getByText("Prywatna", { exact: true })).toBeVisible();
    await inBothThemes(page, () => expectNoAccessibilityViolations(page));

    // Renaming and removing the place work from the page of the collection.
    await card.click();
    await page.getByLabel("Nazwa", { exact: true }).fill("Wieże i baszty (test)");
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Zapisano zmiany." })).toHaveText(
      "Zapisano zmiany.",
    );
    await page.getByRole("button", { name: `Usuń z kolekcji: ${PLACE}` }).click();
    const places = page.getByRole("heading", { level: 2, name: "Miejsca (0)" });

    await expect(places).toBeVisible();
    // The row is gone with its button: the focus moves to the heading of the list (not to
    // the body) and the answer stays in a region that outlives the row.
    await expect(places).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "Usunięto z kolekcji." })).toHaveText(
      "Usunięto z kolekcji.",
    );

    // The confirmation takes the focus, and "Anuluj" gives it back.
    await page.getByRole("button", { name: "Usuń kolekcję" }).click();
    await expect(page.getByRole("button", { name: "Tak, usuń kolekcję" })).toBeFocused();
    await page.getByRole("button", { name: "Anuluj" }).click();
    await expect(page.getByRole("button", { name: "Usuń kolekcję" })).toBeFocused();
    await page.getByRole("button", { name: "Usuń kolekcję" }).click();
    await page.getByRole("button", { name: "Tak, usuń kolekcję" }).click();
    await expect(page).toHaveURL(/\/my\/collections$/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Moje własne kolekcje (0)" }),
    ).toBeVisible();

    await page.context().close();
  });

  test("another explorer and a guest do not see the collection of the first one", async ({
    browser,
  }) => {
    const pageA = await signedInPage(browser, EXPLORER_A);
    const id = await createCollection(pageA);
    const pageB = await signedInPage(browser, EXPLORER_B);

    await pageB.goto("/my/collections");
    await expect(
      pageB.getByRole("heading", { level: 2, name: "Moje własne kolekcje (0)" }),
    ).toBeVisible();
    await expect(pageB.getByRole("link", { name: OWN_TITLE })).toHaveCount(0);

    // The same screen as for an address that does not exist.
    await pageB.goto(`/my/collections/own/${id}`);
    await expect(pageB.getByRole("heading", { level: 1, name: "Nie znaleziono" })).toBeVisible();
    await expect(pageB.getByText(OWN_TITLE)).toHaveCount(0);

    // B's attempts to change or delete it through the API find nothing (404), and it stays.
    const headers = { origin: new URL(pageB.url()).origin };
    const renamed = await pageB.request.put(`/api/me/own-collections/${id}`, {
      headers,
      data: { title: "Przejęta", summary: "", region: "polska", version: 1 },
    });
    const deleted = await pageB.request.delete(`/api/me/own-collections/${id}`, { headers });

    expect(renamed.status()).toBe(404);
    expect(deleted.status()).toBe(404);
    await pageA.reload();
    await expect(pageA.getByRole("heading", { level: 1, name: OWN_TITLE })).toBeVisible();

    // A guest is sent to sign in and the API answers 401.
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();

    await guestPage.goto(`/my/collections/own/${id}`);
    await expect(guestPage).toHaveURL(/\/login\?returnTo=/);
    expect((await guest.request.get("/api/me/own-collections")).status()).toBe(401);

    await guest.close();
    await pageA.context().close();
    await pageB.context().close();
  });

  test("the pages fit a phone screen", async ({ browser }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await page.setViewportSize({ width: 320, height: 640 });
    await createCollection(page);

    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.goto("/my/collections");
    await expect(page.getByRole("link", { name: OWN_TITLE })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.context().close();
  });
});
