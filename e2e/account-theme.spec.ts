import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// E9-4: motyw zapamiętany na koncie (docs#65 AC1, Q11 wariant A). Zalogowana osoba przełącza
// motyw, wybór zapisuje się na koncie i wraca po zalogowaniu w nowym kontekście przeglądarki
// (bez ciasteczek); gość i pierwsza wizyta startują w motywie nocnym. Konto demo user2; wiersz
// ustawień kasujemy po teście, żeby nie zmieniał motywu innym plikom. Wymaga zmigrowanej bazy
// z kontami demo; bez niej plik jest pomijany.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const EXPLORER = "user2@demo.krajozbior.local";

async function adminQuery<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  // Zapisuje i kasuje wiersze konta demo, więc działa tylko na jednorazowej bazie testowej.
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

const storedTheme = async () =>
  (
    await adminQuery<{ theme: string }>(
      `select s.theme from public.account_settings s join auth.users u on u.id = s.user_id
        where u.email = $1`,
      [EXPLORER],
    )
  )[0]?.theme ?? null;

const cleanUp = () =>
  adminQuery(
    `delete from public.account_settings where user_id in (select id from auth.users where email = $1)`,
    [EXPLORER],
  );

async function signIn(page: Page) {
  await page.goto("/login");

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(EXPLORER);
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);
}

async function newPage(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });

  return { context, page: await context.newPage() };
}

test.describe("motyw na koncie", () => {
  test.skip(
    !password || !process.env.DATABASE_ADMIN_URL,
    "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required",
  );
  test.describe.configure({ mode: "serial" });

  test.beforeAll(cleanUp);
  test.afterAll(cleanUp);

  test("wybór jasnego motywu zapisuje się na koncie i wraca po zalogowaniu w nowej przeglądarce", async ({
    browser,
  }) => {
    const first = await newPage(browser);

    await signIn(first.page);
    await expect(first.page.locator("html")).toHaveClass(/theme-dark/);
    await waitForHydration(first.page);

    await first.page.getByRole("banner").getByRole("button", { name: "Jasny motyw" }).click();
    await expect(first.page.locator("html")).toHaveClass(/theme-light/);
    await expect.poll(storedTheme).toBe("light");

    await first.page.getByRole("main").getByRole("button", { name: "Wyloguj" }).click();
    await expect(first.page).toHaveURL(/\/\?wylogowano=1$/);
    await first.context.close();

    // Nowy kontekst: bez ciasteczek, więc gość startuje w motywie nocnym.
    const second = await newPage(browser);

    await second.page.goto("/login");
    await expect(second.page.locator("html")).toHaveClass(/theme-dark/);

    await signIn(second.page);
    await expect(second.page.locator("html")).toHaveClass(/theme-light/);
    await expect(
      second.page.getByRole("banner").getByRole("button", { name: "Nocny motyw" }),
    ).toBeVisible();

    // Powrót do nocnego też wraca na koncie.
    await waitForHydration(second.page);
    await second.page.getByRole("banner").getByRole("button", { name: "Nocny motyw" }).click();
    await expect(second.page.locator("html")).toHaveClass(/theme-dark/);
    await expect.poll(storedTheme).toBe("dark");
    await second.context.close();

    const third = await newPage(browser);

    await signIn(third.page);
    await expect(third.page.locator("html")).toHaveClass(/theme-dark/);
    await third.context.close();
  });

  test("gość przełącza motyw tylko w ciasteczku i nic nie trafia na żadne konto", async ({
    browser,
  }) => {
    // The first test left the account with the night theme: start from an account without a row.
    await cleanUp();

    const { context, page } = await newPage(browser);

    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/theme-dark/);
    await waitForHydration(page);
    await page.getByRole("banner").getByRole("button", { name: "Jasny motyw" }).click();
    await expect(page.locator("html")).toHaveClass(/theme-light/);

    expect(await storedTheme()).toBeNull();
    await context.close();
  });
});
