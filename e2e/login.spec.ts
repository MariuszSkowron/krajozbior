import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

const password = process.env.DEMO_ACCOUNT_PASSWORD;
// The local e-mail outbox of the test server (like account-deletion.spec.ts).
const OUTBOX = path.resolve(process.cwd(), ".data", "e2e-email-outbox");

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

const newAddress = (label: string) =>
  `l-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;
// Read before playwright.config.ts adds its fallback: only a real database counts.
const hasDatabase = Boolean(process.env.DATABASE_URL);

test("a guest opening a private page is sent to login", async ({ page }) => {
  // Better Auth checks the database schema on first use, even for a guest.
  test.skip(!hasDatabase, "DATABASE_URL with a migrated database is required");

  await page.goto("/my");

  await expect(page).toHaveURL(/\/login\?returnTo=%2Fmy$/);
  await expect(page).toHaveTitle("Logowanie — Krajozbiór");
  await expect(page.getByRole("heading", { level: 1, name: "Logowanie" })).toBeVisible();
  await expect(page.getByLabel("E-mail").first()).toBeVisible();
});

// D-49 (K-09, K-10): the address is typed once; the code step masks it and keeps it out of the URL.
test.describe("sign-in with a code in two steps", () => {
  test.skip(!hasDatabase, "DATABASE_URL with a migrated database is required");

  test("the password form is hidden until 'Logowanie hasłem' is opened", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByLabel("Hasło")).toBeHidden();

    await page.getByText("Logowanie hasłem").click();

    await expect(page.getByLabel("Hasło")).toBeVisible();
  });

  test("e-mail, then the masked step 2 with the code field in focus, then signed in", async ({
    page,
  }) => {
    const email = newAddress("flow");
    const known = new Set(await outboxFiles());

    await page.goto("/login");
    await page.locator("#code-request-email").fill(email);
    await page.getByRole("button", { name: "Wyślij kod" }).click();

    await expect(page.getByText("Wpisz kod wysłany na adres")).toContainText("l…@example.com");
    await expect(page.getByRole("main").getByRole("status")).toContainText("kod jest już w drodze");
    await expect(page.getByLabel("Kod z wiadomości (6 cyfr)")).toBeFocused();
    await expect(page.locator("#code-request-email")).toHaveCount(0);
    expect(page.url()).not.toContain("example.com");
    expect(page.url()).not.toContain("%40");
    await expect(page.getByRole("button", { name: "Wyślij kod ponownie" })).toBeVisible();

    await page.getByLabel("Kod z wiadomości (6 cyfr)").fill(await codeFor(email, known));
    await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();

    await expect(page).not.toHaveURL(/\/login/);
    // The address kept between the steps is gone after the sign-in.
    const cookies = await page.context().cookies();
    expect(cookies.some((cookie) => cookie.name === "krajozbior_login_email")).toBe(false);
  });

  test("a wrong code keeps step 2 and 'Zmień adres' goes back to step 1", async ({ page }) => {
    const email = newAddress("change");

    await page.goto("/login");
    await page.locator("#code-request-email").fill(email);
    await page.getByRole("button", { name: "Wyślij kod" }).click();
    await page.getByLabel("Kod z wiadomości (6 cyfr)").fill("000000");
    await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();

    await expect(page.locator("main [role=alert]")).toContainText("Kod jest nieprawidłowy");
    await expect(page.getByText("Wpisz kod wysłany na adres")).toBeVisible();
    // The error takes the focus and the code field is described by it.
    await expect(page.locator("#code-error")).toBeFocused();
    await expect(page.locator("#code-verify-code")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#code-verify-code")).toHaveAttribute(
      "aria-describedby",
      /code-error/,
    );

    await page.getByRole("button", { name: "Zmień adres" }).click();

    await expect(page.getByRole("button", { name: "Wyślij kod", exact: true })).toBeVisible();
    await expect(page.locator("#code-request-email")).toHaveValue("");
    await expect(page.getByLabel("Kod z wiadomości (6 cyfr)")).toHaveCount(0);
  });
});

// These also need seeded accounts; the CI e2e job provides database and seed.
test.describe("with seeded demo accounts", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  async function logIn(page: import("@playwright/test").Page, email: string, pass: string) {
    await page.getByText("Logowanie hasłem").click();

    const form = page.locator("form", { has: page.getByLabel("Hasło") });

    await form.getByLabel("E-mail").fill(email);
    await form.getByLabel("Hasło").fill(pass);
    await form.getByRole("button", { name: "Zaloguj się" }).click();
  }

  test("a demo user logs in, returns to the page and is refused the admin route", async ({
    page,
    request,
  }) => {
    await page.goto("/my");
    await logIn(page, "user@demo.krajozbior.local", password ?? "");

    await expect(page).toHaveURL(/\/my$/);
    await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();

    const me = await page.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).role).toBe("user");
    expect((await page.request.get("/api/admin")).status()).toBe(403);

    // A separate client without the session cookie is still a guest.
    expect((await request.get("/api/admin")).status()).toBe(401);
  });

  test("a curator without returnTo lands in the panel, with returnTo on that page", async ({
    page,
    browser,
  }) => {
    await page.goto("/login");
    await logIn(page, "curator-a@demo.krajozbior.local", password ?? "");

    await expect(page).toHaveURL(/\/curator$/);
    await expect(page.getByRole("heading", { level: 1, name: "Twoje kolekcje" })).toBeVisible();

    // The screen "Konto" of a signed-in curator points to the panel.
    await page.goto("/login");
    await expect(page.getByRole("link", { name: "Przejdź do panelu kuratora" })).toHaveAttribute(
      "href",
      "/curator",
    );

    const other = await browser.newContext();
    const withReturn = await other.newPage();

    await withReturn.goto("/login?returnTo=%2Fsearch");
    await logIn(withReturn, "curator-b@demo.krajozbior.local", password ?? "");

    await expect(withReturn).toHaveURL(/\/search$/);
    await other.close();
  });

  test("an admin can use the admin route", async ({ page }) => {
    await page.goto("/login");
    await logIn(page, "admin@demo.krajozbior.local", password ?? "");

    await expect(page).toHaveURL(/\/my$/);
    const response = await page.request.get("/api/admin");
    expect(response.status()).toBe(200);
    expect((await response.json()).role).toBe("admin");
  });

  test("wrong credentials show a generic error and keep the guest signed out", async ({ page }) => {
    await page.goto("/login");
    await logIn(page, "user@demo.krajozbior.local", "definitely-not-the-password");

    await expect(page.locator("main [role=alert]")).toContainText(
      "Nieprawidłowy e-mail lub hasło.",
    );
    expect((await page.request.get("/api/me")).status()).toBe(401);
  });

  test("a signed-in user can log out", async ({ page }) => {
    await page.goto("/login");
    await logIn(page, "user@demo.krajozbior.local", password ?? "");
    await expect(page).toHaveURL(/\/my$/);

    await page.getByRole("banner").getByRole("button", { name: "Wyloguj" }).click();

    await expect(page).toHaveURL(/\/\?wylogowano=1$/);
    expect((await page.request.get("/api/me")).status()).toBe(401);
  });

  test("the production login page does not list demo accounts", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Konta demonstracyjne" })).toHaveCount(0);
  });
});
