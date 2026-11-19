import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";

// E9-1: the "Profil" screen and logging out. The profile shows only entries that
// lead to existing screens, "Wyloguj" ends the session and every private screen
// then refuses the guest, also after "back". Uses the demo explorer; needs a
// migrated, seeded database like the other specs that sign in; without it the
// spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const EXPLORER = "user@demo.krajozbior.local";
const PRIVATE_PATHS = [
  "/my",
  "/my/collections",
  "/my/want-to-see",
  "/my/settings",
  "/my/delete-account",
] as const;

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

async function signedInPage(browser: Browser, width = 390, email = EXPLORER): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await context.newPage();

  await page.goto("/login");

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(email);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);

  return page;
}

test.describe("profile and logout", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test("the profile shows the role, links to existing screens only and fits a phone", async ({
    browser,
  }) => {
    const page = await signedInPage(browser);
    const main = page.getByRole("main");

    await expect(page).toHaveTitle("Profil — Krajozbiór");
    await expect(main.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();
    await expect(main).toContainText("Twoja rola: Użytkownik");
    await expect(main.getByRole("link")).toHaveText([
      "Moje kolekcje",
      "Chcę zobaczyć",
      "Ustawienia",
    ]);
    await expect(main.getByRole("button", { name: "Wyloguj" })).toBeVisible();
    // No dead entries: contact arrives with its screen (E9-6).
    await expect(main).not.toContainText("Napisz do nas");

    // The bottom bar marks the profile as the current item.
    await expect(page.locator('nav[aria-label="Główna"] a[aria-current="page"]')).toHaveText(
      "Profil",
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    for (const link of await main.getByRole("link").all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }

    await expectNoAccessibilityViolations(page);

    await page
      .context()
      .addCookies([{ name: "krajozbior-theme", value: "light", url: "http://127.0.0.1" }]);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/theme-light/);
    await expectNoAccessibilityViolations(page);

    await page.context().close();
  });

  test("the bottom bar item leads to the profile", async ({ browser }) => {
    const page = await signedInPage(browser);

    await page.goto("/my/collections");
    await page.locator('nav[aria-label="Główna"]').getByRole("link", { name: "Profil" }).click();
    await expect(page).toHaveURL(/\/my$/);
    await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();

    await page.context().close();
  });

  test("logging out ends the session on every private screen and after going back", async ({
    browser,
  }) => {
    const page = await signedInPage(browser);

    await page.getByRole("main").getByRole("button", { name: "Wyloguj" }).click();
    await expect(page).toHaveURL(/\/\?wylogowano=1$/);

    // Real "back": the previous history entry is the profile the user just left.
    // The page is sent with `Cache-Control: private, no-store` (src/proxy.ts), so
    // the browser neither reuses it from the HTTP cache nor restores it from the
    // back/forward cache; the request reaches the server and the guest is sent to
    // the login screen.
    await page.goBack();
    await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent("/my")}`);
    await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toHaveCount(0);

    expect((await page.request.get("/api/me")).status()).toBe(401);

    for (const path of PRIVATE_PATHS) {
      await page.goto(path);
      await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent(path)}`);
      await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toHaveCount(0);
    }

    await page.context().close();
  });
});

// E9-2: name, region and visibility of the profile, with two accounts. The new
// account has a private profile without a name; the form saves the profile (a
// native post, works without JavaScript); another explorer sees nothing of it;
// a guest and a body that names an owner are refused. The demo accounts are
// shared with other specs, so the test puts both profiles back to the defaults.
const EXPLORER_B = "user2@demo.krajozbior.local";

async function saveProfile(
  page: Page,
  values: { name: string; initial: string; region: string; visible: boolean },
) {
  await page.goto("/my/settings");
  await page.getByLabel("Imię", { exact: true }).fill(values.name);
  await page.getByLabel("Pierwsza litera nazwiska").fill(values.initial);
  await page.getByLabel("Region").selectOption({ label: values.region });
  await page.getByLabel(values.visible ? "Inni odkrywcy" : "Tylko ja").check();
  await page.getByRole("button", { name: "Zapisz profil" }).click();
}

test.describe("profile data: name, region, visibility", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test("a new profile is private and nameless; saving shows the name, region and visibility, and survives a reload", async ({
    browser,
  }) => {
    const page = await signedInPage(browser);

    try {
      const main = page.getByRole("main");

      await expect(main.getByTestId("profile-name")).toHaveText("Odkrywca");
      await expect(main).toContainText("Profil niewidoczny");

      await saveProfile(page, { name: "Anna", initial: "k", region: "Pomorskie", visible: true });
      await expect(page).toHaveURL(/\/my\/settings\?profil=zapisano/);
      await expect(page.getByRole("status")).toHaveText("Zapisano zmiany w profilu.");

      await page.goto("/my");
      await expect(main.getByTestId("profile-name")).toHaveText("Anna K.");
      await expect(main).toContainText("Pomorskie");
      await expect(main).toContainText("Profil widoczny");
      await page.reload();
      await expect(main.getByTestId("profile-name")).toHaveText("Anna K.");

      await page.goto("/my/settings");
      await expect(page.getByLabel("Imię", { exact: true })).toHaveValue("Anna");
      await expect(page.getByLabel("Pierwsza litera nazwiska")).toHaveValue("K");
      await expect(page.getByLabel("Region")).toHaveValue("pomorskie");
      await expect(page.getByLabel("Inni odkrywcy")).toBeChecked();
    } finally {
      await saveProfile(page, { name: "", initial: "", region: "Nie podaję", visible: false });
      await page.context().close();
    }
  });

  test("a wrong name is refused with a message at the field, and nothing is saved", async ({
    browser,
  }) => {
    const page = await signedInPage(browser);

    await saveProfile(page, { name: "Anna2", initial: "", region: "Nie podaję", visible: false });
    await expect(page).toHaveURL(/\/my\/settings\?profil=blad&pola=firstName/);
    await expect(page.getByRole("alert")).toContainText("Imię: wpisz do 40 liter");
    await expect(page.getByLabel("Imię", { exact: true })).toHaveAttribute("aria-invalid", "true");

    await page.goto("/my");
    await expect(page.getByTestId("profile-name")).toHaveText("Odkrywca");

    await page.context().close();
  });

  test("another explorer sees nothing of the profile of the first, and a guest or a foreign owner is refused", async ({
    browser,
  }) => {
    const a = await signedInPage(browser, 390, EXPLORER);
    const b = await signedInPage(browser, 390, EXPLORER_B);

    try {
      await saveProfile(a, { name: "Anna", initial: "K", region: "Pomorskie", visible: true });
      await expect(a).toHaveURL(/profil=zapisano/);

      await b.goto("/my");
      await expect(b.getByTestId("profile-name")).toHaveText("Odkrywca");
      await expect(b.getByRole("main")).not.toContainText("Anna");
      await expect(b.getByRole("main")).toContainText("Profil niewidoczny");
      await b.goto("/my/settings");
      await expect(b.getByLabel("Imię", { exact: true })).toHaveValue("");
      await expect(b.getByLabel("Region")).toHaveValue("");
      await expect(b.getByLabel("Tylko ja")).toBeChecked();

      // B saves a profile of their own; A keeps theirs.
      await saveProfile(b, { name: "Bartek", initial: "", region: "Śląskie", visible: false });
      await a.goto("/my");
      await expect(a.getByTestId("profile-name")).toHaveText("Anna K.");

      // The route takes no owner: a body that names one is refused and writes nothing.
      const named = await b.request.put("/api/me/profile", {
        data: {
          firstName: "Hak",
          familyInitial: null,
          region: null,
          visibility: "public",
          userId: "11111111-1111-4111-8111-111111111111",
        },
      });

      expect(named.status()).toBe(400);
      expect(named.headers()["cache-control"]).toBe("private, no-store");
      await b.goto("/my");
      await expect(b.getByTestId("profile-name")).toHaveText("Bartek");

      // A guest gets 401 whatever the body is.
      const guest = await browser.newContext();

      expect(
        (
          await guest.request.put("/api/me/profile", {
            data: { firstName: "X", familyInitial: null, region: null, visibility: "public" },
          })
        ).status(),
      ).toBe(401);
      await guest.close();
    } finally {
      for (const page of [a, b]) {
        await saveProfile(page, { name: "", initial: "", region: "Nie podaję", visible: false });
        await page.context().close();
      }
    }
  });

  test("the profile and the settings screens fit a phone and pass the accessibility check in both themes", async ({
    browser,
  }) => {
    const page = await signedInPage(browser);

    for (const theme of ["dark", "light"]) {
      await page
        .context()
        .addCookies([{ name: "krajozbior-theme", value: theme, url: "http://127.0.0.1" }]);

      for (const path of ["/my", "/my/settings"]) {
        await page.goto(path);
        await expectNoAccessibilityViolations(page);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        ).toBe(0);
      }
    }

    await page.goto("/my/settings?profil=blad&pola=firstName,region");
    await expectNoAccessibilityViolations(page);

    await page.context().close();
  });
});
