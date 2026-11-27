import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "../tests/support/e2e-hydration";

// Zapis kolekcji tuż po publikacji albo wycofaniu: strona odświeża dane z opóźnieniem, a zapis
// idzie wcześniej. Formularz ma wtedy wysłać wersję z odpowiedzi publikacji, nie starą ze strony
// (inaczej dostaje fałszywy konflikt 409). Potrzebuje zmigrowanej i zasianej bazy jak
// `catalog-access.spec.ts`; bez niej spec jest pomijany.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const emailOf = (name: string) => `${name}@demo.krajozbior.local`;
const REFRESH_DELAY_MS = 4000;

async function signIn(page: Page, name: string) {
  await page.goto("/login");
  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(emailOf(name));
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/curator$/);
}

async function createDraftWithPlace(page: Page, title: string): Promise<string> {
  await page.goto("/curator");
  await page.getByRole("link", { name: "Nowa kolekcja" }).click();
  await waitForHydration(page);
  await page.getByLabel("Nazwa", { exact: true }).fill(title);
  await page.getByLabel("Krótki opis").fill("Kolekcja z testu przeglądarkowego.");
  await page.getByRole("button", { name: "Utwórz szkic kolekcji" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

  const editorPath = new URL(page.url()).pathname;

  await page.getByRole("link", { name: "Dodaj nowe miejsce" }).click();
  await expect(page).toHaveURL(/\/places\/new$/);
  await waitForHydration(page);
  await page.getByLabel("Nazwa", { exact: true }).fill("Miejsce testowe");
  await page.getByLabel("Adres", { exact: true }).fill("Tczew");
  await page.getByText("Współrzędne i promień potwierdzania wizyty", { exact: true }).click();
  await page.getByLabel("Szerokość geograficzna").fill("54,0928");
  await page.getByLabel("Długość geograficzna").fill("18.7919");
  await page.getByRole("button", { name: "Dodaj miejsce do kolekcji" }).click();
  await expect(page).toHaveURL(new RegExp(`${editorPath}(\\?.*)?$`));
  await expect(page.getByRole("link", { name: "Miejsce testowe" })).toBeVisible();

  return editorPath;
}

test.describe("save right after publication", () => {
  test.skip(!password, "needs a seeded database");

  test("saving before the page refreshes sends the version from the publication answer", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await signIn(page, "curator-a");
    await createDraftWithPlace(page, `Zapis po publikacji ${Date.now()}`);
    await waitForHydration(page);

    // Odświeżenie danych strony (żądanie RSC) przychodzi z opóźnieniem.
    await page.route("**/curator/collections/**", async (route) => {
      if (route.request().headers().rsc === "1") {
        await new Promise((resolve) => setTimeout(resolve, REFRESH_DELAY_MS));
      }

      await route.continue();
    });

    const status = (text: string) => page.getByRole("status").filter({ hasText: text });
    const save = async (summary: string) => {
      await page.getByLabel("Krótki opis").fill(summary);
      await page.getByRole("button", { name: "Zapisz zmiany" }).click();
      await expect(status("Zapisano zmiany.")).toBeVisible({ timeout: 3000 });
      await expect(page.locator("main [role=alert]")).toHaveCount(0);
    };

    await page.getByRole("button", { name: "Publikuj" }).click();
    await expect(status("opublikowana")).toBeVisible();
    await save("Opis po publikacji.");

    // Po ostatnim odświeżeniu strona pokazuje opublikowaną kolekcję.
    await expect(page.getByRole("button", { name: "Wycofaj publikację" })).toBeVisible({
      timeout: 15000,
    });
    await waitForHydration(page);
    await page.getByRole("button", { name: "Wycofaj publikację" }).click();
    await expect(status("Publikacja wycofana")).toBeVisible();
    await save("Opis po wycofaniu.");

    await context.close();
  });
});
