import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// E2-S2 / E2-S3, PR7: "Potwierdzam wizytę" on the place page, with the position
// of the device set by Playwright (setGeolocation). Most Tczewski of the demo
// collection is at 54.0928, 18.7919 with the default radius of 200 m. Needs a
// migrated, seeded database like the other specs that sign in; without it the
// spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const DEMO_SLUG = "demo-mosty-i-zamki-nad-wisla";
const EXPLORER_A = "user@demo.krajozbior.local";
const EXPLORER_B = "user2@demo.krajozbior.local";
const BRIDGE = { latitude: 54.0928, longitude: 18.7919 };
// About 6 km north of the bridge: out of the radius.
const FAR = { latitude: 54.1468, longitude: 18.7919 };

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

async function signedInPage(browser: Browser, email: string, geolocation = true): Promise<Page> {
  const context = await browser.newContext(
    geolocation ? { permissions: ["geolocation"], geolocation: { ...BRIDGE, accuracy: 20 } } : {},
  );
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

// Visits and saves of the two demo explorers are removed straight in the
// database before and after each test, so a failed run leaves no trace.
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

const visitCount = async (email: string) =>
  Number(
    (
      await adminQuery<{ n: string }>(
        `select count(*) as n from public.visits where user_id = (select id from auth.users where email = $1)`,
        [email],
      )
    )[0]!.n,
  );

test.describe("confirming a visit on site", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("a guest is sent to sign in and comes back to the place", async ({ page }) => {
    await page.goto(`/collections/${DEMO_SLUG}`);
    await page.goto(
      (await page.getByRole("link", { name: /Most Tczewski/ }).getAttribute("href")) ?? "",
    );

    await expect(page).toHaveURL(/\/places\/[0-9a-f-]{36}$/);

    const placePath = new URL(page.url()).pathname;

    await page.getByRole("main").getByRole("link", { name: "Zaloguj się", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/login\\?returnTo=${encodeURIComponent(placePath)}$`));
  });

  test("in range: the visit is recorded, the progress grows to 1/3, B sees nothing", async ({
    browser,
  }) => {
    const a = await signedInPage(browser, EXPLORER_A);
    const b = await signedInPage(browser, EXPLORER_B);

    await a.goto(`/collections/${DEMO_SLUG}`);
    await a.getByRole("button", { name: "Zapisuję kolekcję" }).click();
    await expect(a.getByRole("button", { name: "Usuń z zapisanych" })).toBeVisible();
    // The nearest place not visited yet, counted from the bridge: the castle in Malbork (about 17 km;
    // Gniew is about 29 km). Its address is read from the collection page.
    const malborkHref =
      (await a.getByRole("link", { name: /Zamek w Malborku/ }).getAttribute("href")) ?? "";

    expect(malborkHref).toMatch(/^\/places\/[0-9a-f-]{36}$/);
    await openBridge(a);
    await expectNoAccessibilityViolations(a);

    await a.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(a.getByText("Most Tczewski jest w Twoim albumie.")).toBeVisible();

    const message = a
      .getByRole("status")
      .filter({ hasText: "Most Tczewski jest w Twoim albumie." });
    const next = a.getByRole("list", { name: "Co dalej" });

    // The page is read again after the visit: only then the list names the next place. The focus
    // is checked after that, so it proves the message survived the refresh.
    await expect(next.getByRole("link", { name: "Zamek w Malborku" })).toHaveAttribute(
      "href",
      malborkHref,
    );
    await expect(next).toContainText("Zostały Ci 2 miejsca w kolekcji");
    await expect(next).toContainText("Najbliższe nieodwiedzone:");
    await expect(next.getByRole("link", { name: "Zamek w Gniewie" })).toHaveCount(0);
    await expect(message).toBeFocused();
    await expectNoAccessibilityViolations(a);
    expect(await visitCount(EXPLORER_A)).toBe(1);

    // The place is now visited: the page says so instead of offering the button.
    await a.reload();
    await expect(a.getByText("Odwiedzone", { exact: true }).first()).toBeVisible();
    await expect(a.getByRole("button", { name: "Potwierdzam wizytę" })).toHaveCount(0);

    // Explorer B has no visit and still sees the button.
    await b.goto(a.url());
    await expect(b.getByRole("button", { name: "Potwierdzam wizytę" })).toBeVisible();
    expect(await visitCount(EXPLORER_B)).toBe(0);

    await a.context().close();
    await b.context().close();
  });

  test("an older browser without crypto.randomUUID still records the visit", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await page.addInitScript(() => {
      Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    });
    await openBridge(page);
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");
    await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(page.getByText("Most Tczewski jest w Twoim albumie.")).toBeVisible();
    expect(await visitCount(EXPLORER_A)).toBe(1);
    await page.context().close();
  });

  test("without any source of random values the button returns with a message", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await page.addInitScript(() => {
      Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
      Object.defineProperty(crypto, "getRandomValues", { value: undefined, configurable: true });
    });
    await openBridge(page);
    await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Ta przeglądarka nie pozwala zapisać wizyty." }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Potwierdzam wizytę" })).toBeEnabled();
    expect(await visitCount(EXPLORER_A)).toBe(0);
    await page.context().close();
  });

  test("out of range: the distance is shown, the check can be repeated, no visit exists", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await page.context().setGeolocation({ ...FAR, accuracy: 20 });
    await openBridge(page);
    await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /Jesteś .* km od miejsca\./ }),
    ).toBeVisible();
    expect(await visitCount(EXPLORER_A)).toBe(0);
    await expectNoAccessibilityViolations(page);

    // Walking to the bridge and checking again records the visit.
    await page.context().setGeolocation({ ...BRIDGE, accuracy: 20 });
    await page.getByRole("button", { name: "Sprawdź ponownie" }).click();
    await expect(page.getByText("Most Tczewski jest w Twoim albumie.")).toBeVisible();
    expect(await visitCount(EXPLORER_A)).toBe(1);
    await page.context().close();
  });

  test("too inaccurate: the accuracy is shown and no visit exists", async ({ browser }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await page.context().setGeolocation({ ...BRIDGE, accuracy: 500 });
    await openBridge(page);
    await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(
      page.getByText(
        "Lokalizacja jest zbyt niedokładna (±500 m). Spróbuj na zewnątrz albo zaznacz wizytę z przeszłości.",
      ),
    ).toBeVisible();
    expect(await visitCount(EXPLORER_A)).toBe(0);
    await page.context().close();
  });

  test("a refused permission and a browser without geolocation get their own messages", async ({
    browser,
  }) => {
    const denied = await signedInPage(browser, EXPLORER_A, false);

    await openBridge(denied);
    await denied.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(
      denied.getByRole("alert").filter({ hasText: "Nie mamy zgody na lokalizację." }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(denied);
    expect(await visitCount(EXPLORER_A)).toBe(0);
    await denied.context().close();

    const unsupported = await signedInPage(browser, EXPLORER_A);

    await unsupported.addInitScript(() => {
      delete (Navigator.prototype as unknown as Record<string, unknown>).geolocation;
    });
    await openBridge(unsupported);
    await unsupported.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(
      unsupported
        .getByRole("alert")
        .filter({ hasText: "Ta przeglądarka nie obsługuje lokalizacji." }),
    ).toBeVisible();
    expect(await visitCount(EXPLORER_A)).toBe(0);
    await unsupported.context().close();
  });

  test("a retry after a lost answer sends the same attempt and creates one visit (D4)", async ({
    browser,
  }) => {
    const page = await signedInPage(browser, EXPLORER_A);
    const bodies: string[] = [];

    await page.route("**/api/places/*/visits", async (route) => {
      bodies.push(route.request().postData() ?? "");

      if (bodies.length === 1) {
        // The server records the visit, but the answer never reaches the page.
        await route.fetch();
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });
    await openBridge(page);
    await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Brak połączenia." })).toBeVisible();
    await page.getByRole("button", { name: "Spróbuj ponownie" }).click();
    await expect(page.getByText("Most Tczewski jest w Twoim albumie.")).toBeVisible();

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(await visitCount(EXPLORER_A)).toBe(1);
    await page.context().close();
  });

  test("a long name of the next place fits a 320 px screen", async ({ browser }) => {
    const longName =
      "Zespół zamkowy Zakonu Krzyżackiego w Malborku wraz z Przedzamczem, Fosą i Murami Obronnymi";

    await adminQuery(`update public.places set name = $1 where name = 'Zamek w Malborku'`, [
      longName,
    ]);

    try {
      const page = await signedInPage(browser, EXPLORER_A);

      await page.setViewportSize({ width: 320, height: 640 });
      await openBridge(page);
      await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();

      const link = page.getByRole("list", { name: "Co dalej" }).getByRole("link", {
        name: longName,
      });

      await expect(link).toBeVisible();

      const box = await link.boundingBox();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow).toBeLessThanOrEqual(0);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
      await page.context().close();
    } finally {
      await adminQuery(`update public.places set name = 'Zamek w Malborku' where name = $1`, [
        longName,
      ]);
    }
  });

  test("the place page fits a phone screen", async ({ browser }) => {
    const page = await signedInPage(browser, EXPLORER_A);

    await page.setViewportSize({ width: 320, height: 640 });
    await page.context().setGeolocation({ ...FAR, accuracy: 20 });
    await openBridge(page);
    await page.getByRole("button", { name: "Potwierdzam wizytę" }).click();
    await expect(page.getByText(/Jesteś .* km od miejsca\./)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
    await page.context().close();
  });
});
