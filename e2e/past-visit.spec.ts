import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// E2-S6, PR9: a visit from the past ("Byłem tu wcześniej") for one place on its
// page and for many places on the collection page. Needs a migrated, seeded
// database like the other specs that sign in; without it the spec is skipped.
// The cleanup deletes rows of the two demo accounts straight in the database,
// so it runs only against the disposable E2E database (parseE2eAdminDatabaseUrl).
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const EXPLORER_A = "user@demo.krajozbior.local";
const EXPLORER_B = "user2@demo.krajozbior.local";
const BRIDGE = { latitude: 54.0928, longitude: 18.7919 };
const THEME_COOKIE = "krajozbior-theme";

async function expectNoAccessibilityViolations(page: Page) {
  // Wejście sekcji przygasza treść; axe liczy kontrast dopiero po końcu animacji.
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

async function signedInPage(browser: Browser, email: string, geolocation = false): Promise<Page> {
  const context = await browser.newContext(
    geolocation ? { permissions: ["geolocation"], geolocation: { ...BRIDGE, accuracy: 20 } } : {},
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
  const users = [[EXPLORER_A, EXPLORER_B]];

  await adminQuery(
    `delete from public.visits where user_id in (select id from auth.users where email = any($1::text[]))`,
    users,
  );
  await adminQuery(
    `delete from public.saved_collections where user_id in (select id from auth.users where email = any($1::text[]))`,
    users,
  );
}

async function visitRows(email: string) {
  return adminQuery<{ kind: string; precision: string | null; on: string | null }>(
    `select kind, date_precision as precision, visited_on::text as on from public.visits
      where user_id = (select id from auth.users where email = $1)`,
    [email],
  );
}

async function openBridge(page: Page) {
  await page.goto(`/collections/${DEMO_SLUG}`);
  await page.getByRole("link", { name: /Most Tczewski/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Most Tczewski" })).toBeVisible();
  // The forms are client components: wait until the page is interactive.
  await page.waitForLoadState("networkidle");
}

async function saveDemoCollection(page: Page) {
  await page.goto(`/collections/${DEMO_SLUG}`);
  await page.getByRole("button", { name: "Zapisz kolekcję" }).click();
  await expect(page.getByRole("button", { name: "Usuń z zapisanych" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function chooseMonth(page: Page, month: string, year: string) {
  await page.getByRole("radio", { name: "Miesiąc" }).check();
  await page.getByRole("combobox", { name: "Miesiąc" }).selectOption({ label: month });
  await page.getByRole("textbox", { name: "Rok miesiąca" }).fill(year);
}

async function setLightTheme(page: Page) {
  await page
    .context()
    .addCookies([{ name: THEME_COOKIE, value: "light", url: "http://127.0.0.1" }]);
  await page.reload();
  await page.waitForLoadState("networkidle");
}

test.describe("a visit from the past", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("one place: marked with a month, the badge shows it, the confirm button stays, B sees nothing", async ({
    browser,
  }) => {
    const a = await signedInPage(browser, EXPLORER_A);
    const b = await signedInPage(browser, EXPLORER_B);

    await saveDemoCollection(a);
    await openBridge(a);
    await a.getByRole("button", { name: "Byłem tu wcześniej" }).click();
    await expect(a.getByRole("radio", { name: "Nie pamiętam" })).toBeChecked();
    await expect(a.getByRole("radio", { name: "Nie pamiętam" })).toBeFocused();
    await chooseMonth(a, "marzec", "2019");
    await a.getByRole("button", { name: "Zapisz wizytę z przeszłości" }).click();

    const status = a.getByRole("status").filter({ hasText: "Zapisano 1 wizytę z przeszłości." });

    await expect(status).toBeVisible();
    await expect(status).toBeFocused();
    await expect(a.getByText("Z przeszłości · marzec 2019")).toBeVisible();
    // A visit from the past does not hide the confirmation on site (D-10).
    await expect(a.getByRole("button", { name: "Potwierdź wizytę" })).toBeVisible();
    expect(await visitRows(EXPLORER_A)).toEqual([
      { kind: "past", precision: "month", on: "2019-03-01" },
    ]);

    // The progress of the saved collection grows to 1/3.
    await a.goto(`/collections/${DEMO_SLUG}`);
    await expect(a.getByText("1/3 odwiedzone")).toBeVisible();

    // Explorer B has no visit and sees the plain place page.
    await openBridge(b);
    await expect(b.getByText("Z przeszłości", { exact: false })).toHaveCount(0);
    await expect(b.getByRole("button", { name: "Byłem tu wcześniej" })).toBeVisible();
    expect(await visitRows(EXPLORER_B)).toEqual([]);

    await a.context().close();
    await b.context().close();
  });

  test("a date that is still being typed is not sent, and a date from the future is refused", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await openBridge(page);
    await page.getByRole("button", { name: "Byłem tu wcześniej" }).click();
    await page.getByRole("radio", { name: "Rok" }).check();
    await page.getByRole("button", { name: "Zapisz wizytę z przeszłości" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Uzupełnij datę albo wybierz „Nie pamiętam”." }),
    ).toBeVisible();
    expect(await visitRows(EXPLORER_A)).toEqual([]);

    await page.getByRole("textbox", { name: "Rok", exact: true }).fill("2999");
    await page.getByRole("button", { name: "Zapisz wizytę z przeszłości" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Sprawdź datę" })).toBeVisible();
    expect(await visitRows(EXPLORER_A)).toEqual([]);
    await page.context().close();
  });

  test("too inaccurate: the message offers the visit from the past, saved as 'I do not remember'", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A, true);

    await page.context().setGeolocation({ ...BRIDGE, accuracy: 500 });
    await openBridge(page);
    await page.getByRole("button", { name: "Potwierdź wizytę" }).click();
    await expect(
      page.getByText(
        "Lokalizacja jest zbyt niedokładna (±500 m). Spróbuj na zewnątrz albo zaznacz wizytę z przeszłości.",
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "Byłem tu wcześniej" }).click();
    await page.getByRole("button", { name: "Zapisz wizytę z przeszłości" }).click();
    await expect(page.getByText("Z przeszłości · data nieznana")).toBeVisible();
    expect(await visitRows(EXPLORER_A)).toEqual([{ kind: "past", precision: "unknown", on: null }]);
    await page.context().close();
  });

  test("a visit from the past, then the confirmation on site: the badge becomes 'Odwiedzone'", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A, true);

    await openBridge(page);
    await page.getByRole("button", { name: "Byłem tu wcześniej" }).click();
    await page.getByRole("radio", { name: "Rok" }).check();
    await page.getByRole("textbox", { name: "Rok", exact: true }).fill("2018");
    await page.getByRole("button", { name: "Zapisz wizytę z przeszłości" }).click();
    await expect(page.getByText("Z przeszłości · 2018")).toBeVisible();

    await page.getByRole("button", { name: "Potwierdź wizytę" }).click();
    await expect(page.getByText("Wizyta potwierdzona.")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Masz już zapisaną wizytę w tym miejscu.")).toBeVisible();
    await expect(page.getByText("Odwiedzone", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Potwierdź wizytę" })).toHaveCount(0);
    expect((await visitRows(EXPLORER_A)).map((row) => row.kind).sort()).toEqual([
      "on_site",
      "past",
    ]);
    await page.context().close();
  });

  test("a visit from the past can be taken back", async ({ browser }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await openBridge(page);
    await page.getByRole("button", { name: "Byłem tu wcześniej" }).click();
    await page.getByRole("button", { name: "Zapisz wizytę z przeszłości" }).click();
    await expect(page.getByText("Z przeszłości · data nieznana")).toBeVisible();

    await page.getByRole("button", { name: "Usuń wizytę z przeszłości" }).click();

    const status = page.getByRole("status").filter({ hasText: "Usunięto wizytę z przeszłości." });

    await expect(status).toBeVisible();
    await expect(status).toBeFocused();
    await expect(page.getByRole("button", { name: "Byłem tu wcześniej" })).toBeVisible();
    expect(await visitRows(EXPLORER_A)).toEqual([]);
    await page.context().close();
  });

  test("many places: two of three marked at once, the progress grows to 2/3, B sees nothing", async ({
    browser,
  }) => {
    const a = await signedInPage(browser, EXPLORER_A);
    const b = await signedInPage(browser, EXPLORER_B);

    await saveDemoCollection(a);
    await a.getByRole("button", { name: "Zaznacz odwiedzone" }).click();
    await a.getByRole("checkbox", { name: /Most Tczewski/ }).check();
    await a.getByRole("checkbox", { name: /Zamek w Gniewie/ }).check();
    await a.getByRole("button", { name: "Zapisz wizyty z przeszłości" }).click();

    const status = a.getByRole("status").filter({ hasText: "Zapisano 2 wizyty z przeszłości." });

    await expect(status).toBeVisible();
    await expect(status).toBeFocused();
    await expect(a.getByText("2/3 odwiedzone")).toBeVisible();
    await expect(a.getByText("Z przeszłości", { exact: true })).toHaveCount(2);
    expect((await visitRows(EXPLORER_A)).map((row) => row.kind)).toEqual(["past", "past"]);

    // A place with a visit has no checkbox any more: one visit per place.
    await a.getByRole("button", { name: "Zaznacz odwiedzone" }).click();
    await expect(a.getByRole("checkbox")).toHaveCount(1);
    await expect(a.getByRole("checkbox", { name: /Zamek w Malborku/ })).toBeVisible();

    await b.goto(`/collections/${DEMO_SLUG}`);
    await expect(b.getByText("Z przeszłości", { exact: true })).toHaveCount(0);
    expect(await visitRows(EXPLORER_B)).toEqual([]);

    await a.context().close();
    await b.context().close();
  });

  test("accessibility: the place form and the choice of places in both themes", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await openBridge(page);
    await page.getByRole("button", { name: "Byłem tu wcześniej" }).click();
    await chooseMonth(page, "marzec", "2019");
    await expectNoAccessibilityViolations(page);

    await setLightTheme(page);
    await page.getByRole("button", { name: "Byłem tu wcześniej" }).click();
    await chooseMonth(page, "marzec", "2019");
    await expectNoAccessibilityViolations(page);

    await page.goto(`/collections/${DEMO_SLUG}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Zaznacz odwiedzone" }).click();
    await page.getByRole("checkbox", { name: /Most Tczewski/ }).check();
    await expectNoAccessibilityViolations(page);

    // A saved visit shows its badge in the list, in the light theme too.
    await page.getByRole("button", { name: "Zapisz wizyty z przeszłości" }).click();
    await expect(page.getByText("Z przeszłości", { exact: true })).toHaveCount(1);
    await expectNoAccessibilityViolations(page);

    await page
      .context()
      .addCookies([{ name: THEME_COOKIE, value: "dark", url: "http://127.0.0.1" }]);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expectNoAccessibilityViolations(page);
    await page.context().close();
  });

  test("phone: the form is not covered by the pinned button and the page does not overflow", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await page.setViewportSize({ width: 320, height: 640 });
    await openBridge(page);
    await page.getByRole("button", { name: "Byłem tu wcześniej" }).click();
    await chooseMonth(page, "marzec", "2019");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);

    // Playwright clicks only a button that nothing covers; the pinned button must not hide it.
    await page.getByRole("button", { name: "Zapisz wizytę z przeszłości" }).click();
    await expect(page.getByText("Z przeszłości · marzec 2019")).toBeVisible();
    await page.context().close();
  });
});
