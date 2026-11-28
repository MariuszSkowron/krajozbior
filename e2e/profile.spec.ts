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

  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(email);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(my)?$/);
  // An account with no visit and no saved collection lands on the start page; these tests
  // start on the profile.
  await page.goto("/my");

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
    // Paczka N: no role name for an explorer and no tiles that repeat the main menu.
    await expect(main).not.toContainText("Twoja rola");
    await expect(main).not.toContainText("Użytkownik");
    // P4b: "Moje zgłoszenia" is there because the E2E server runs with FEATURE_PLACE_REPORTS=true;
    // without the switch the list is the two entries below (tests/app/my-page.test.ts).
    // The "Zostań kuratorem — w przygotowaniu" block (documents 1.1) adds the partners' address.
    await expect(main.getByRole("link")).toHaveText([
      "partnerzy@krajozbior.pl",
      "Moje zgłoszenia",
      "Ustawienia",
      "Napisz do nas",
    ]);
    await expect(main.getByRole("link", { name: "Moje kolekcje" })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Chcę zobaczyć" })).toHaveCount(0);
    // UX-06: "Profil" is only in the menu. On a phone (where this test runs) "Wyloguj" is only
    // here, on the profile; the header has it on a computer only (D-54 P20 B).
    await expect(page.getByRole("banner").getByRole("link", { name: /^Profil/ })).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("button", { name: "Wyloguj" })).toHaveCount(0);
    // E9-6a: contact is a mailto link to the team's address (no form, no data).
    const contact = main.getByRole("link", { name: "Napisz do nas" });
    await expect(contact).toBeVisible();
    await expect(contact).toHaveAttribute("href", /^mailto:/);
    await expect(main.getByRole("button", { name: "Wyloguj" })).toBeVisible();

    // The bottom bar marks the profile as the current item.
    await expect(page.locator('nav[aria-label="Główna"] a[aria-current="page"]')).toHaveText(
      "Profil",
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    // The address inside the curator block's sentence is an inline link (exempt from the 44 px
    // target, WCAG 2.5.8); every other link is a separate target.
    const separateLinks = main.getByRole("link").filter({ hasNotText: "partnerzy@krajozbior.pl" });

    for (const link of await separateLinks.all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }

    // Na telefonie liczby i odnośniki zajmują pełną szerokość treści (390 px minus marginesy).
    const phoneWidth = (await main.getByTestId("profile-stats").boundingBox())?.width ?? 0;
    expect(phoneWidth).toBeGreaterThanOrEqual(330);
    // Trzy liczby stoją w jednym rzędzie (ta sama współrzędna top), bez pustej połowy ekranu.
    const tops = await main
      .getByTestId("profile-stats")
      .locator("dd")
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    expect(tops).toHaveLength(3);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
    expect(
      (await main.getByRole("link", { name: "Ustawienia" }).boundingBox())?.width ?? 0,
    ).toBeGreaterThanOrEqual(330);

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

async function saveProfile(page: Page, values: { name: string; initial: string; region: string }) {
  await page.goto("/my/settings");
  await page.getByLabel("Imię", { exact: true }).fill(values.name);
  await page.getByLabel("Pierwsza litera nazwiska").fill(values.initial);
  await page.getByLabel("Region").selectOption({ label: values.region });
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
      await expect(main).toContainText("Tylko Ty widzisz swój profil.");
      await expect(main.getByTestId("profile-email")).toContainText("@");

      await saveProfile(page, { name: "Anna", initial: "k", region: "Pomorskie" });
      await expect(page).toHaveURL(/\/my\/settings\?profil=zapisano/);
      await expect(
        page
          .getByRole("main")
          .getByRole("status")
          .filter({ hasText: "Zapisano zmiany w profilu." }),
      ).toBeVisible();

      await page.goto("/my");
      await expect(main.getByTestId("profile-name")).toHaveText("Anna K.");
      await expect(main).toContainText("Pomorskie");
      await expect(main).toContainText("Tylko Ty widzisz swój profil.");
      await page.reload();
      await expect(main.getByTestId("profile-name")).toHaveText("Anna K.");

      await page.goto("/my/settings");
      await expect(page.getByLabel("Imię", { exact: true })).toHaveValue("Anna");
      await expect(page.getByLabel("Pierwsza litera nazwiska")).toHaveValue("K");
      await expect(page.getByLabel("Region")).toHaveValue("pomorskie");
      // No choice of visibility on the screen (R-024); the account e-mail is shown instead.
      await expect(page.getByLabel("Inni odkrywcy")).toHaveCount(0);
      await expect(page.getByRole("radio")).toHaveCount(0);
      await expect(page.getByTestId("account-email")).toContainText("@");
    } finally {
      await saveProfile(page, { name: "", initial: "", region: "Nie podaję" });
      await page.context().close();
    }
  });

  test("each account sees only its own e-mail address; another account and a guest see none of it, and the pages are private, no-store", async ({
    browser,
  }) => {
    const other = "user2@demo.krajozbior.local";
    const pageA = await signedInPage(browser);
    const pageB = await signedInPage(browser, 390, other);
    const guest = await browser.newContext();

    try {
      for (const [page, own, foreign] of [
        [pageA, EXPLORER, other],
        [pageB, other, EXPLORER],
      ] as const) {
        const profile = await page.goto("/my");

        expect(profile?.headers()["cache-control"]).toBe("private, no-store");
        await expect(page.getByTestId("profile-email")).toHaveText(own);
        expect(await profile!.text()).not.toContain(foreign);

        const settings = await page.goto("/my/settings");

        expect(settings?.headers()["cache-control"]).toBe("private, no-store");
        await expect(page.getByTestId("account-email")).toContainText(own);
        expect(await settings!.text()).not.toContain(foreign);
      }

      // A guest is sent to the login screen, and no page of theirs carries an account address.
      const guestPage = await guest.newPage();
      const redirected = await guestPage.goto("/my");

      await expect(guestPage).toHaveURL(/\/login/);
      expect(await redirected!.text()).not.toContain("@demo.krajozbior.local");
      expect(await guestPage.content()).not.toContain("@demo.krajozbior.local");
    } finally {
      await pageA.context().close();
      await pageB.context().close();
      await guest.close();
    }
  });

  test("a wrong name is refused with a message at the field, and nothing is saved", async ({
    browser,
  }) => {
    const page = await signedInPage(browser);

    await saveProfile(page, { name: "Anna2", initial: "", region: "Nie podaję" });
    await expect(page).toHaveURL(/\/my\/settings\?profil=blad&pola=firstName/);
    await expect(
      page.getByRole("main").getByRole("alert").filter({ hasText: "Imię może mieć do 40 liter" }),
    ).toBeVisible();

    const field = page.getByLabel("Imię", { exact: true });

    await expect(field).toHaveAttribute("aria-invalid", "true");
    // The typed value stays, and it never travels in the URL.
    await expect(field).toHaveValue("Anna2");
    expect(page.url()).not.toContain("Anna2");
    // The message at the field is tied to it, and focus lands on the summary of errors.
    await expect(field).toHaveAttribute("aria-describedby", /profile-firstName-error/);
    await expect(page.locator("#profile-firstName-error")).toContainText(
      "Imię może mieć do 40 liter",
    );
    await expect(page.locator("#profile-error")).toBeFocused();

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
      await saveProfile(a, { name: "Anna", initial: "K", region: "Pomorskie" });
      await expect(a).toHaveURL(/profil=zapisano/);

      await b.goto("/my");
      await expect(b.getByTestId("profile-name")).toHaveText("Odkrywca");
      await expect(b.getByRole("main")).not.toContainText("Anna");
      await expect(b.getByRole("main")).toContainText("Tylko Ty widzisz swój profil.");
      await b.goto("/my/settings");
      await expect(b.getByLabel("Imię", { exact: true })).toHaveValue("");
      await expect(b.getByLabel("Region")).toHaveValue("");

      // B saves a profile of their own; A keeps theirs.
      await saveProfile(b, { name: "Bartek", initial: "", region: "Śląskie" });
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
        await saveProfile(page, { name: "", initial: "", region: "Nie podaję" });
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
