import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";
import { waitForHydration } from "../tests/support/e2e-hydration";

// Paczka 4 (kurator, minimum): ostrzeżenie o niezapisanych zmianach przy wyjściu z edytora
// kolekcji i miejsca (menu, linki, zamknięcie karty), link „Zobacz stronę kolekcji” po publikacji
// i tekst przy szkicu, liczba zapisów na liście, zdanie przy „Wycofaj”. Potrzebuje zmigrowanej
// i zasianej bazy; bez niej spec jest pomijany.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
const createdCollectionIds: string[] = [];

async function removeCreatedData() {
  const collectionIds = createdCollectionIds.splice(0);

  if (collectionIds.length === 0) {
    return;
  }

  const client = new Client({
    connectionString: parseE2eAdminDatabaseUrl(process.env.DATABASE_ADMIN_URL),
  });

  await client.connect();
  try {
    const { rows } = await client.query(
      "select place_id from public.collection_places where collection_id = any($1::uuid[])",
      [collectionIds],
    );

    await client.query(
      "delete from public.collection_places where collection_id = any($1::uuid[])",
      [collectionIds],
    );
    await client.query("delete from public.collections where id = any($1::uuid[])", [
      collectionIds,
    ]);
    await client.query("delete from public.places where id = any($1::uuid[])", [
      rows.map((row: { place_id: string }) => row.place_id),
    ]);
  } finally {
    await client.end();
  }
}

async function signInAsCurator(page: Page) {
  await page.goto("/login");
  await page.getByText("Logowanie hasłem").click();

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill("curator-a@demo.krajozbior.local");
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/curator$/);
}

async function newCollection(page: Page, title: string): Promise<string> {
  const response = await page.request.post("/api/curator/collections", {
    data: { title, region: "pomorskie", summary: "Kolekcja z testu przeglądarkowego." },
  });

  expect(response.ok(), await response.text()).toBe(true);

  const id = String(((await response.json()) as { id: string }).id);

  createdCollectionIds.push(id);

  return id;
}

async function addPlace(page: Page, collectionId: string, name: string) {
  const response = await page.request.post(`/api/curator/collections/${collectionId}/places`, {
    data: {
      name,
      description: "",
      address: "Tczew",
      accessInfo: "",
      accessRestriction: "none",
      latitude: 54.0928,
      longitude: 18.7919,
      visitRadiusM: 100,
    },
  });

  expect(response.ok(), await response.text()).toBe(true);
}

const leaveDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Masz niezapisane zmiany. Wyjść bez zapisu?" });
const menuCollections = (page: Page) =>
  page.getByRole("navigation", { name: "Panel kuratora" }).getByRole("link", { name: "Kolekcje" });
const breadcrumbCollections = (page: Page) =>
  page.getByRole("navigation", { name: "Ścieżka" }).getByRole("link", { name: "Kolekcje" });

test.describe("curator editors: unsaved changes, public page link, saves", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.afterEach(removeCreatedData);

  test("leaving the collection editor with unsaved text asks first; stay keeps the text", async ({
    page,
  }) => {
    await signInAsCurator(page);

    const id = await newCollection(page, `Ostrzeżenie ${Date.now()}`);
    const editor = `/curator/collections/${id}`;

    await page.goto(editor);
    await waitForHydration(page);

    const name = page.getByLabel("Nazwa", { exact: true });

    await name.fill("Nowa nazwa, jeszcze niezapisana");
    await expect(page.getByText("Masz niezapisane zmiany", { exact: true })).toBeVisible();

    // The menu of the panel.
    await menuCollections(page).click();
    await expect(leaveDialog(page)).toBeVisible();
    await page.screenshot({ path: ".ai/tmp/p4/edytor-ostrzezenie.png" });
    await leaveDialog(page).getByRole("button", { name: "Zostań" }).click();
    await expect(leaveDialog(page)).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${editor}$`));
    await expect(name).toHaveValue("Nowa nazwa, jeszcze niezapisana");

    // The breadcrumb and a link in the page ("Dodaj nowe miejsce").
    await breadcrumbCollections(page).click();
    await expect(leaveDialog(page)).toBeVisible();
    await leaveDialog(page).getByRole("button", { name: "Zostań" }).click();

    await page.getByRole("link", { name: "Dodaj nowe miejsce" }).click();
    await expect(leaveDialog(page)).toBeVisible();
    await leaveDialog(page).getByRole("button", { name: "Wyjdź bez zapisu" }).click();
    await expect(page).toHaveURL(/\/places\/new$/);
  });

  test("closing the tab with unsaved text is asked by the browser; no question after a save", async ({
    page,
  }) => {
    await signInAsCurator(page);

    const id = await newCollection(page, `Zamknięcie karty ${Date.now()}`);

    await page.goto(`/curator/collections/${id}`);
    await waitForHydration(page);
    await page.getByLabel("Nazwa", { exact: true }).fill("Zmieniona nazwa");

    const asked = page.waitForEvent("dialog");

    await page.close({ runBeforeUnload: true });

    const dialog = await asked;

    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();

    // A saved form is clean: the menu leads away without a question.
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Zapisano zmiany." })).toBeVisible();
    await menuCollections(page).click();
    await expect(page).toHaveURL(/\/curator$/);
    await expect(leaveDialog(page)).toBeHidden();
  });

  test("the place editor asks as well, and saving the place leaves without a question", async ({
    page,
  }) => {
    await signInAsCurator(page);

    const id = await newCollection(page, `Miejsce ostrzeżenie ${Date.now()}`);

    await addPlace(page, id, "Miejsce do zmiany");
    await page.goto(`/curator/collections/${id}`);
    await waitForHydration(page);
    await page.getByRole("link", { name: "Miejsce do zmiany" }).click();
    await waitForHydration(page);

    await page.getByLabel("Opis", { exact: true }).fill("Dłuższy opis, który nie może zginąć.");
    await breadcrumbCollections(page).click();
    await expect(leaveDialog(page)).toBeVisible();
    await leaveDialog(page).getByRole("button", { name: "Zostań" }).click();
    await expect(page.getByLabel("Opis", { exact: true })).toHaveValue(
      "Dłuższy opis, który nie może zginąć.",
    );

    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page).toHaveURL(new RegExp(`/curator/collections/${id}(\\?.*)?$`));
    await expect(leaveDialog(page)).toBeHidden();
  });

  test("a draft says there is no public page yet; after publication the link opens it", async ({
    page,
    context,
  }) => {
    await signInAsCurator(page);

    const title = `Strona publiczna ${Date.now()}`;
    const id = await newCollection(page, title);

    await addPlace(page, id, "Miejsce publiczne");
    await page.goto(`/curator/collections/${id}`);
    await waitForHydration(page);

    await expect(page.getByText("Szkic nie ma jeszcze strony publicznej.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Zobacz stronę kolekcji" })).toHaveCount(0);

    await page.getByRole("button", { name: "Publikuj" }).click();

    const link = page.getByRole("link", { name: "Zobacz stronę kolekcji" });

    await expect(link).toBeVisible();
    await expect(
      page.getByText("Opublikowanej kolekcji nie da się usunąć, tylko wycofać."),
    ).toBeVisible();

    const opened = context.waitForEvent("page");

    await link.click();

    const publicPage = await opened;

    await publicPage.waitForLoadState();
    await expect(publicPage).toHaveURL(/\/collections\/[a-z0-9-]+$/);
    await expect(publicPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await page.screenshot({ path: ".ai/tmp/p4/edytor-link-do-strony.png" });
    await publicPage.close();
  });

  test("the list shows the number of saves, only a number", async ({ page }) => {
    await signInAsCurator(page);
    await newCollection(page, `Zapisy ${Date.now()}`);
    await page.goto("/curator");

    await expect(page.getByRole("columnheader", { name: "Zapisy" })).toBeVisible();
    await expect(
      page.getByText("Widzisz tylko liczbę, nie to, kto zapisał kolekcję."),
    ).toBeVisible();
    await expect(page.getByTestId("save-count").first()).toHaveText(/^\d+$/);
    await page.screenshot({ path: ".ai/tmp/p4fix2/lista-zapisy.png", fullPage: true });
  });
});
