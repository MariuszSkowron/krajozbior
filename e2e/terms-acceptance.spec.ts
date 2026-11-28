import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { Client } from "pg";

import { CURRENT_TERMS_VERSION } from "../src/features/terms/domain/terms-version";
import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// F-K3: strony prawne, stopka, linki na ekranie logowania, pasek „Wersja testowa”, `noindex`
// i ekran „Zanim zaczniesz” (akceptuję / nie akceptuję), z kontrolą dostępności (axe) w obu
// motywach. Konta demo mają akceptację nadaną przed przebiegiem (e2e/global-setup.ts), więc ekran
// akceptacji sprawdzają konta, które ten plik zakłada kodem z e-maila (skrzynka lokalna serwera
// testowego `.data/e2e-email-outbox`, jak w account-deletion.spec.ts). Wymaga zmigrowanej bazy.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const OUTBOX = path.resolve(process.cwd(), ".data", "e2e-email-outbox");

const LEGAL = [
  { path: "/regulamin", title: "Regulamin" },
  { path: "/polityka-prywatnosci", title: "Polityka prywatności" },
  { path: "/zasady", title: "Najważniejsze zasady" },
  {
    path: "/oswiadczenie-o-zdjeciach",
    title: "Oświadczenie o prawach do zdjęcia i licencja (załącznik nr 1)",
  },
  {
    path: "/umowa-powierzenia",
    title: "Umowa powierzenia przetwarzania danych osobowych (załącznik nr 2)",
  },
] as const;

// Each address may ask for three codes in 15 minutes: every test makes its own.
const newAddress = (label: string) =>
  `k3-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;

async function setTheme(page: Page, theme: "dark" | "light") {
  await page
    .context()
    .addCookies([{ name: "krajozbior-theme", value: theme, url: "http://127.0.0.1" }]);
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

const outboxFiles = async () =>
  (await readdir(OUTBOX).catch(() => [] as string[])).filter((name) => name.endsWith(".eml"));

// The six digits of the newest message to `email` that was not there before `known`.
async function codeFor(email: string, known: ReadonlySet<string>): Promise<string> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    for (const file of (await outboxFiles())
      .filter((name) => !known.has(name))
      .sort()
      .reverse()) {
      const raw = await readFile(path.join(OUTBOX, file), "utf8");

      if (!raw.includes(`To: ${email}`)) {
        continue;
      }

      for (const [, body] of raw.matchAll(
        /Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+?)(?=\r?\n--)/g,
      )) {
        const text = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
        const code = /\b(\d{6})\b/.exec(text)?.[1];

        if (code !== undefined) {
          return code;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("The sign-in code did not arrive in the outbox");
}

// Asks for a code on /login, reads it from the outbox and signs in; the first sign-in with an
// address creates the account. It does NOT accept the terms: the tests do that or refuse it.
async function signInWithCode(page: Page, email: string, entry: "login" | "signup" = "login") {
  const known = new Set(await outboxFiles());

  await page.goto(entry === "signup" ? "/login/zaloz-konto" : "/login");
  await page.locator("#code-request-email").fill(email);
  await page.getByRole("button", { name: "Wyślij kod" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("kod jest już w drodze");

  await page.locator("#code-verify-code").fill(await codeFor(email, known));
  await page
    .getByRole("button", { name: entry === "signup" ? "Załóż konto" : "Zaloguj się", exact: true })
    .click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function acceptances(email: string): Promise<{ terms_version: string }[]> {
  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    return (
      await client.query(
        `select t.terms_version from public.terms_acceptance t
           join auth.users u on u.id = t.user_id where u.email = $1`,
        [email],
      )
    ).rows;
  } finally {
    await client.end();
  }
}

const gateHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Zanim zaczniesz" });

test.describe("strony prawne, stopka i pasek", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  for (const viewport of [
    { name: "telefon", width: 390, height: 844 },
    { name: "komputer", width: 1280, height: 800 },
  ]) {
    test(`stopka na ${viewport.name}: cztery odnośniki, każdy otwiera stronę`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();

      await page.goto("/");

      const footer = page.getByRole("contentinfo");

      await expect(footer.getByRole("link", { name: "Polityka prywatności" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Najważniejsze zasady" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Kontakt" })).toHaveAttribute(
        "href",
        "mailto:kontakt@krajozbior.pl",
      );

      await expect(footer.getByRole("link", { name: "Zgłoś naruszenie" })).toHaveAttribute(
        "href",
        /^mailto:zgloszenia@krajozbior\.pl\?subject=.+&body=.+/,
      );

      await footer.getByRole("link", { name: "Regulamin" }).click();
      await expect(page).toHaveURL(/\/regulamin$/);
      await expect(page.getByRole("heading", { level: 1, name: "Regulamin" })).toBeVisible();
      await context.close();
    });
  }

  test("ekrany logowania i zakładania konta nie mówią o regulaminie i nie mają pola akceptacji", async ({
    page,
  }) => {
    for (const address of ["/login", "/login/zaloz-konto"]) {
      await page.goto(address);

      // The terms are accepted in the next step, on the screen "Zanim zaczniesz".
      await expect(page.getByRole("main").getByRole("link", { name: "Regulamin" })).toHaveCount(0);
      await expect(page.getByRole("main").getByText(/regulamin/i)).toHaveCount(0);
      // Not telling a new address from a known one: no checkbox on these screens (E11-Q4 A).
      await expect(page.getByRole("checkbox")).toHaveCount(0);
    }
  });

  test("pasek „Wersja konkursowa” prowadzi do zasad i zamyka się na czas sesji", async ({
    page,
  }) => {
    await page.goto("/");

    const banner = page.getByRole("region", { name: "Wersja konkursowa" });

    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link", { name: "Najważniejsze zasady" })).toHaveAttribute(
      "href",
      "/zasady",
    );

    await banner.getByRole("button", { name: "Zamknij" }).click();
    await expect(banner).toBeHidden();

    // Closed for the session: it stays closed on the next page.
    await page.goto("/regulamin");
    await expect(banner).toBeHidden();
  });

  test("strony prawne są indeksowane, ekran logowania ma noindex; strony kolekcji też nie mają", async ({
    page,
  }) => {
    for (const legal of LEGAL) {
      await page.goto(legal.path);
      await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    }

    await page.goto("/login");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    await page.goto("/");
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`strony prawne, motyw ${theme}: nagłówki po kolei i axe bez naruszeń`, async ({
      page,
    }) => {
      await setTheme(page, theme);

      for (const legal of LEGAL) {
        await page.goto(legal.path);
        await expect(page.getByRole("heading", { level: 1, name: legal.title })).toBeVisible();
        await expect(
          page.getByText("Wersja 1.1 — obowiązuje od 28 listopada 2026 r."),
        ).toBeVisible();
        await expectNoAccessibilityViolations(page);
      }
    });
  }
});

test.describe("ekran „Zanim zaczniesz”", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test("nowe konto widzi tylko ten ekran, akceptuje i wchodzi dalej; zapis ma wersję i czas", async ({
    page,
  }) => {
    const email = newAddress("accept");

    await signInWithCode(page, email);

    await expect(gateHeading(page)).toBeVisible();
    // Only the screen and the logout: no main navigation, no explorer pages behind it.
    await expect(page.getByRole("navigation", { name: "Główna" })).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("button", { name: "Wyloguj" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(await acceptances(email)).toEqual([]);

    await page.goto("/my");
    await expect(gateHeading(page)).toBeVisible();

    // The checkbox is required: the form is not sent without it, and the message is in Polish
    // (not the browser's own bubble), tied to the field (UX-12).
    await page.getByRole("button", { name: "Akceptuję", exact: true }).click();
    await expect(gateHeading(page)).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Zaznacz pole" })).toContainText(
      "Zaznacz pole „Akceptuję Regulamin”.",
    );
    await expect(page.getByLabel(/Akceptuję Regulamin/)).toBeFocused();
    await expect(page.getByLabel(/Akceptuję Regulamin/)).toHaveAttribute("aria-invalid", "true");
    expect(await acceptances(email)).toEqual([]);

    await page.getByLabel(/Akceptuję Regulamin/).check();
    await page.getByRole("button", { name: "Akceptuję", exact: true }).click();

    await expect(page).toHaveURL(/\/my$/);
    await expect(gateHeading(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Główna" })).toBeVisible();
    expect(await acceptances(email)).toEqual([{ terms_version: CURRENT_TERMS_VERSION }]);

    // The next visit does not ask again.
    await page.goto("/my/settings");
    await expect(gateHeading(page)).toHaveCount(0);
  });

  test("po „Zaloguj się” z nowym adresem ekran wyjaśnia, że założono konto; po „Załóż konto” nie", async ({
    page,
  }) => {
    const notice = page.getByText("Dla tego adresu nie było jeszcze konta, więc je założyliśmy.");

    await signInWithCode(page, newAddress("first-login"), "login");
    await expect(gateHeading(page)).toBeVisible();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(
      "Masz konto założone na inny adres? Wyloguj się i zaloguj tamtym.",
    );

    // The explanation does not stay in the address after the acceptance.
    await page.getByLabel(/Akceptuję Regulamin/).check();
    await page.getByRole("button", { name: "Akceptuję", exact: true }).click();
    await expect(gateHeading(page)).toHaveCount(0);
    expect(page.url()).not.toContain("wejscie");

    const other = await page.context().browser()!.newContext();
    const signup = await other.newPage();

    await signInWithCode(signup, newAddress("signup"), "signup");
    await expect(gateHeading(signup)).toBeVisible();
    await expect(signup.getByText("Dla tego adresu nie było jeszcze konta")).toHaveCount(0);
    await other.close();
  });

  test("strony prawne dają się czytać przed akceptacją, a ekran wraca po powrocie", async ({
    page,
  }) => {
    await signInWithCode(page, newAddress("legal"));
    await expect(gateHeading(page)).toBeVisible();

    await page.getByRole("main").getByRole("link", { name: "Regulamin", exact: true }).click();
    await expect(page).toHaveURL(/\/regulamin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Regulamin" })).toBeVisible();
    await expect(gateHeading(page)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Główna" })).toHaveCount(0);

    await page.goto("/my/collections");
    await expect(gateHeading(page)).toBeVisible();
  });

  // Regression (M1 of the level A review): Next.js does not draw the layout again on a
  // `next/link` navigation, so the application name in the header led from a legal page to
  // the start page without the screen.
  test("nawigacja klienta ze strony prawnej nie omija ekranu", async ({ page }) => {
    await signInWithCode(page, newAddress("client-nav"));
    await page.goto("/regulamin");
    await expect(page.getByRole("heading", { level: 1, name: "Regulamin" })).toBeVisible();

    // A marker on the window survives only a client navigation, not a full page load.
    await page.evaluate(() => {
      (window as unknown as { k3ClientNav?: boolean }).k3ClientNav = true;
    });
    await page.getByRole("banner").getByRole("link", { name: "Krajozbiór" }).click();

    await expect(page).toHaveURL(/\/$/);
    expect(
      await page.evaluate(() => (window as unknown as { k3ClientNav?: boolean }).k3ClientNav),
    ).toBe(true);
    await expect(gateHeading(page)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Główna" })).toHaveCount(0);
  });

  test("„Nie akceptuję” wylogowuje i mówi, jak usunąć adres; po ponownym logowaniu ekran wraca", async ({
    page,
  }) => {
    const email = newAddress("decline");

    await signInWithCode(page, email);
    await expect(gateHeading(page)).toBeVisible();

    await page.getByRole("button", { name: "Nie akceptuję — wyloguj" }).click();

    await expect(page).toHaveURL(/\/\?wylogowano=odmowa$/);
    const message = page
      .getByRole("status")
      .filter({ hasText: "Konto działa dopiero po akceptacji" });

    await expect(message).toContainText("po akceptacji regulaminu");
    await expect(message.getByRole("link", { name: "prywatnosc@krajozbior.pl" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Zaloguj się" })).toBeVisible();
    expect(await acceptances(email)).toEqual([]);

    await signInWithCode(page, email);
    await expect(gateHeading(page)).toBeVisible();
  });

  test("odmowa akceptacji bez zaznaczonego pola po stronie serwera wraca na ekran z komunikatem", async ({
    page,
  }) => {
    await signInWithCode(page, newAddress("nobox"));

    // A post without the field (a client that skips the native validation).
    const response = await page.request.post("/api/me/terms-acceptance", {
      form: { returnTo: "/my" },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(303);
    expect(response.headers()["location"]).toBe("/?zgoda=wymagana");

    await page.goto("/?zgoda=wymagana");
    // Next.js adds its own empty route announcer with role=alert, so pick ours by its text.
    await expect(page.getByRole("alert").filter({ hasText: "Zaznacz pole" })).toBeVisible();
  });

  test("gość nie zapisze akceptacji", async ({ request }) => {
    const response = await request.post("/api/me/terms-acceptance", { data: { accepted: true } });

    expect(response.status()).toBe(401);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`ekran akceptacji, motyw ${theme}: axe bez naruszeń`, async ({ page }) => {
      await setTheme(page, theme);
      await signInWithCode(page, newAddress(`axe-${theme}`));
      await expect(gateHeading(page)).toBeVisible();

      await expectNoAccessibilityViolations(page);
    });
  }
});
