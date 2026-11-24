import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

// Pierwszy kontakt: nowa osoba zakłada konto przez „Załóż konto” (ten sam mechanizm kodu z
// e-maila co „Zaloguj się”), akceptuje regulamin i ląduje na Starcie z przyciskiem do kolekcji,
// bez bloku „Twój album” z samymi zerami. Telefon (390) i komputer (1440). Konto zakłada kodem z
// lokalnej skrzynki serwera testowego (jak e2e/terms-acceptance.spec.ts). Zrzuty do ręcznego
// przeglądu trafiają do katalogu z P1_SHOTS_DIR (bez zmiennej nic nie zapisuje).
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const OUTBOX = path.resolve(process.cwd(), ".data", "e2e-email-outbox");
const SHOTS_DIR = process.env.P1_SHOTS_DIR;

const newAddress = (label: string) =>
  `p1-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;

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

async function shot(page: Page, name: string) {
  if (SHOTS_DIR === undefined) {
    return;
  }

  await mkdir(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage: false });
}

const overflowOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// The main call to action must be whole on the first screen, above the bottom bar of a phone (or
// above the window's lower edge where there is no bar), without scrolling.
async function expectOnFirstScreen(page: Page, button: Locator) {
  await expect(button).toBeVisible();

  const box = (await button.boundingBox())!;
  const bar = page.getByRole("navigation", { name: "Główna" });
  const barBox = (await bar.isVisible()) ? await bar.boundingBox() : null;
  const windowHeight = page.viewportSize()?.height ?? Infinity;
  // On a computer the menu is at the top; only a bar in the lower half is the bottom bar.
  const limit = barBox !== null && barBox.y > windowHeight / 2 ? barBox.y : windowHeight;

  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(limit);
}

for (const size of [
  { name: "390", width: 390, height: 844 },
  { name: "390x667", width: 390, height: 667 },
  { name: "1440", width: 1440, height: 900 },
]) {
  test.describe(`pierwszy kontakt, ${size.name} px`, () => {
    test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");
    test.use({ viewport: { width: size.width, height: size.height } });

    test("gość wchodzi przez „Załóż konto”, zakłada konto kodem i ląduje na Starcie z przyciskiem do kolekcji", async ({
      page,
    }) => {
      const email = newAddress(`signup-${size.name}`);
      const known = new Set(await outboxFiles());

      await page.goto("/");

      // The banner of a guest: the main button, the second one and the way in for an owner.
      const main = page.getByRole("main");

      await expectOnFirstScreen(page, main.getByRole("link", { name: "Załóż konto" }));
      await shot(page, `start-goscia-${size.name}`);
      await expect(main.getByRole("link", { name: "Zobacz kolekcje" })).toBeVisible();
      await expect(main.getByText("Masz już konto?")).toBeVisible();
      await expect(main.getByRole("link", { name: "Zaloguj się" })).toHaveAttribute(
        "href",
        "/login",
      );

      // The header: "Zaloguj się" always, the button "Załóż konto" on a computer (a phone has it
      // on the banner).
      const header = page.getByRole("banner");

      await expect(header.getByRole("link", { name: "Zaloguj się" })).toBeVisible();
      if (size.width >= 640) {
        await expect(header.getByRole("link", { name: "Załóż konto" })).toBeVisible();
      } else {
        await expect(header.getByRole("link", { name: "Załóż konto" })).toBeHidden();
      }

      await main.getByRole("link", { name: "Załóż konto" }).click();
      await expect(page).toHaveURL(/\/login\/zaloz-konto$/);
      await expect(page).toHaveTitle("Załóż konto — Krajozbiór");
      // Nothing of an existing account is said before the code.
      await expect(page.getByText("Masz już konto z tym adresem")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1, name: "Załóż konto" })).toBeVisible();
      await expect(page.getByText("Hasła nie potrzebujesz.")).toBeVisible();
      await expect(page.getByRole("main").getByText(/regulamin/i)).toHaveCount(0);

      // The cross link and the second column: the photo beside the form on a computer, below it
      // on a phone.
      await expect(page.getByRole("link", { name: "Zaloguj się" }).last()).toHaveAttribute(
        "href",
        "/login",
      );

      const photo = page.getByRole("figure", { name: "Zdjęcie miejsca" });
      const form = page.getByRole("main").locator("form").first();

      await expect(photo).toBeVisible();
      await expect(photo.getByText(/Bezpłatnie i bez reklam/)).toBeVisible();

      const photoBox = (await photo.boundingBox())!;
      const formBox = (await form.boundingBox())!;

      if (size.width >= 768) {
        expect(photoBox.x).toBeGreaterThan(formBox.x + formBox.width - 1);
      } else {
        expect(photoBox.y).toBeGreaterThanOrEqual(formBox.y + formBox.height - 1);
      }
      expect(await overflowOf(page)).toBeLessThanOrEqual(0);
      await shot(page, `zaloz-konto-${size.name}`);

      await page.locator("#code-request-email").fill(email);
      await page.getByRole("button", { name: "Wyślij kod" }).click();
      await expect(page.getByRole("main").getByRole("status")).toContainText(
        "kod jest już w drodze",
      );
      // After the first step the person stays on the signup page.
      await expect(page).toHaveURL(/\/login\/zaloz-konto\?kod=wyslany$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Wpisz kod z wiadomości" }),
      ).toBeVisible();

      await page.locator("#code-verify-code").fill(await codeFor(email, known));
      await page.getByRole("button", { name: "Załóż konto", exact: true }).click();

      // Acceptance of the terms: two columns on a computer, a Polish message instead of the
      // browser's bubble.
      const gate = page.getByRole("heading", { level: 1, name: "Zanim zaczniesz" });

      await expect(gate).toBeVisible();
      await expect(page.getByText("Dla tego adresu nie było jeszcze konta")).toHaveCount(0);
      await expect(page.getByRole("figure", { name: "Zdjęcie miejsca" })).toBeVisible();
      await page.getByRole("button", { name: "Akceptuję", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Zaznacz pole" })).toBeVisible();
      await shot(page, `akceptacja-${size.name}`);
      await page.getByLabel(/Akceptuję Regulamin/).check();
      await page.getByRole("button", { name: "Akceptuję", exact: true }).click();

      // The start page of a new explorer: the big banner with the first step; no album of zeros.
      const start = page.getByRole("main");
      const heading = start.getByRole("heading", { level: 1, name: "Wybierz pierwszą kolekcję" });

      await expect(page).toHaveURL(/\/$/);
      await expect(heading).toBeVisible();
      await expect(start.getByText("Dzień dobry")).toBeVisible();
      await expect(start.getByText("Zapisz kolekcję, a pokażemy tu Twój postęp")).toBeVisible();
      await expect(start.getByRole("region", { name: "Twój album" })).toHaveCount(0);
      await expect(start.getByText("Nie masz jeszcze zapisanych kolekcji")).toHaveCount(0);

      const collections = start.getByRole("link", { name: "Zobacz kolekcje" }).first();

      await expectOnFirstScreen(page, collections);
      await expect(collections).toHaveAttribute("href", "#do-odkrycia");
      expect(await overflowOf(page)).toBeLessThanOrEqual(0);
      await shot(page, `start-nowej-osoby-${size.name}`);

      await collections.click();
      await expect(page).toHaveURL(/#do-odkrycia$/);
      await expect(start.locator("#do-odkrycia")).toBeInViewport();
    });

    test("ekran „Zaloguj się” ma własny nagłówek, tekst i odsyła do „Załóż konto”", async ({
      page,
    }) => {
      await page.goto("/login");

      await expect(page.getByRole("heading", { level: 1, name: "Zaloguj się" })).toBeVisible();
      await expect(page.getByText("Podaj adres e-mail konta. Wyślemy na niego kod.")).toBeVisible();
      // The header has the same link; this one sits in the form column of the page.
      await expect(
        page.getByRole("main").getByRole("link", { name: "Załóż konto" }),
      ).toHaveAttribute("href", "/login/zaloz-konto");
      await expect(page.getByRole("figure", { name: "Zdjęcie miejsca" })).toBeVisible();
      expect(await overflowOf(page)).toBeLessThanOrEqual(0);
      await shot(page, `logowanie-${size.name}`);

      // The way back, with the return address kept.
      await page.goto("/login/zaloz-konto?returnTo=%2Fsearch");
      await expect(page.getByRole("link", { name: "Zaloguj się" }).last()).toHaveAttribute(
        "href",
        "/login?returnTo=%2Fsearch",
      );
    });
  });
}

test.describe("„Załóż konto” adresem, który ma już konto", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");
  test.use({ viewport: { width: 390, height: 844 } });

  async function signUpWith(page: Page, email: string) {
    const known = new Set(await outboxFiles());

    await page.goto("/login/zaloz-konto");
    await page.locator("#code-request-email").fill(email);
    await page.getByRole("button", { name: "Wyślij kod" }).click();
    await page.locator("#code-verify-code").fill(await codeFor(email, known));
    await page.getByRole("button", { name: "Załóż konto", exact: true }).click();
  }

  test("po kodzie mówi, że konto już jest; nowe konto dostaje tylko ekran regulaminu", async ({
    page,
    context,
  }) => {
    const email = newAddress("existing");

    await signUpWith(page, email);
    await expect(page.getByRole("heading", { level: 1, name: "Zanim zaczniesz" })).toBeVisible();
    await expect(page.getByText("Masz już konto z tym adresem")).toHaveCount(0);
    await page.getByLabel(/Akceptuję Regulamin/).check();
    await page.getByRole("button", { name: "Akceptuję", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Wybierz pierwszą kolekcję" }),
    ).toBeVisible();
    await expect(page.getByText("Masz już konto z tym adresem")).toHaveCount(0);

    // The same address again through "Załóż konto": the message comes only after the code.
    await context.clearCookies();
    await signUpWith(page, email);

    const notice = page
      .getByRole("main")
      .getByRole("status")
      .filter({ hasText: "Masz już konto z tym adresem — zalogowaliśmy Cię." });

    await expect(notice).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Wybierz pierwszą kolekcję" }),
    ).toBeVisible();
    await shot(page, "istniejace-konto-390");
  });
});
