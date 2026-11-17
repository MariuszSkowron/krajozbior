import { expect, test, type Browser, type Page } from "@playwright/test";
import axe from "axe-core";

// E1, PR3: the curator panel with two curators of different organizations
// (seeded demo accounts) and an explorer. Needs a migrated, seeded database
// like the login specs; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const DEMO_COLLECTION = "Mosty i zamki nad Wisłą (demo)";
const emailOf = (name: string) => `${name}@demo.krajozbior.local`;

async function signIn(page: Page, name: string) {
  await page.goto("/login");

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(emailOf(name));
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);
}

async function signedInPage(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await signIn(page, name);

  return page;
}

async function expectNoAccessibilityViolations(page: Page) {
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

// Fields typed before React hydrates the form are reset by it; wait for the page to settle.
async function waitForHydration(page: Page) {
  await page.waitForLoadState("networkidle");
}

async function createDraft(page: Page, title: string): Promise<string> {
  await page.goto("/curator");
  await page.getByRole("link", { name: "Nowa kolekcja" }).click();
  await waitForHydration(page);
  await page.getByLabel("Nazwa", { exact: true }).fill(title);
  await page.getByLabel("Krótki opis").fill("Kolekcja z testu przeglądarkowego.");
  await page.getByRole("button", { name: "Utwórz szkic kolekcji" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

  return new URL(page.url()).pathname;
}

async function addPlace(page: Page, editorPath: string, name: string) {
  await page.goto(editorPath);
  await page.getByRole("link", { name: "Dodaj nowe miejsce" }).click();
  await waitForHydration(page);
  await page.getByLabel("Nazwa", { exact: true }).fill(name);
  await page.getByLabel("Adres", { exact: true }).fill("Tczew");
  await page.getByLabel("Szerokość geograficzna").fill("54,0928");
  await page.getByLabel("Długość geograficzna").fill("18.7919");
  await page.getByRole("button", { name: "Dodaj miejsce do kolekcji" }).click();
  await expect(page).toHaveURL(new RegExp(`${editorPath}$`));
  await expect(page.getByRole("link", { name })).toBeVisible();
}

test.describe("curator panel", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test("a guest is sent to login and an account without an organization gets 'not found'", async ({
    page,
    browser,
  }) => {
    await page.goto("/curator");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fcurator$/);

    const explorer = await signedInPage(browser, "user");

    await expect(
      explorer.getByRole("banner").getByRole("link", { name: "Panel kuratora" }),
    ).toHaveCount(0);
    await explorer.goto("/curator");
    await expect(explorer.getByRole("heading", { level: 1, name: "Nie znaleziono" })).toBeVisible();
    await explorer.context().close();
  });

  test("a curator reaches the panel from the shell and sees the collections of the organization", async ({
    browser,
  }) => {
    const curator = await signedInPage(browser, "curator-a");

    await curator.getByRole("banner").getByRole("link", { name: "Panel kuratora" }).click();
    await expect(curator).toHaveURL(/\/curator$/);
    await expect(curator.getByRole("heading", { level: 1, name: "Twoje kolekcje" })).toBeVisible();
    await expect(curator).toHaveTitle("Panel kuratora — Krajozbiór");

    const row = curator.getByRole("row", { name: DEMO_COLLECTION });

    await expect(row).toContainText("Opublikowana");
    await expect(row).toContainText("Pomorskie");
    await expect(row).toContainText("3");
    await expectNoAccessibilityViolations(curator);
    await curator.context().close();
  });

  test("a curator builds a collection: draft, places, order, publication and withdrawal", async ({
    browser,
  }) => {
    const curator = await signedInPage(browser, "curator-a");
    const title = `Trasa testowa ${Date.now()}`;
    const editorPath = await createDraft(curator, title);

    await expect(curator.getByText("Szkic", { exact: true }).first()).toBeVisible();
    await expect(curator.getByText("Ta kolekcja nie ma jeszcze miejsc.")).toBeVisible();

    // Publication needs a place: the refusal is told in Polish, in an alert.
    await curator.getByRole("button", { name: "Publikuj" }).click();
    await expect(curator.locator("main [role=alert]")).toContainText("co najmniej jedno miejsce");

    await addPlace(curator, editorPath, "Pierwsze miejsce");
    await addPlace(curator, editorPath, "Drugie miejsce");

    const items = curator.getByRole("list", { name: "Miejsca w kolejności" }).getByRole("listitem");

    await expect(items.nth(0)).toContainText("Pierwsze miejsce");
    await curator.getByRole("button", { name: "Przesuń niżej: Pierwsze miejsce" }).click();
    await expect(items.nth(0)).toContainText("Drugie miejsce");
    await expect(curator.getByRole("status").filter({ hasText: "Przesunięto" })).toBeVisible();

    // Editing the collection data keeps the other fields and says it was saved.
    await curator.getByLabel("Krótki opis").fill("Nowy opis.");
    await curator.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(curator.getByRole("status").filter({ hasText: "Zapisano zmiany." })).toBeVisible();

    await expectNoAccessibilityViolations(curator);

    await curator.getByRole("button", { name: "Publikuj" }).click();
    await expect(curator.getByRole("status").filter({ hasText: "opublikowana" })).toBeVisible();
    // From a published collection the last place cannot be removed (withdraw first).
    await curator.getByRole("button", { name: "Usuń z kolekcji: Pierwsze miejsce" }).click();
    await expect(
      curator.getByRole("list", { name: "Miejsca w kolejności" }).getByRole("listitem"),
    ).toHaveCount(1);
    await curator.getByRole("button", { name: "Usuń z kolekcji: Drugie miejsce" }).click();
    await expect(curator.locator("main [role=alert]")).toContainText(
      "To ostatnie miejsce opublikowanej kolekcji. Najpierw wycofaj publikację.",
    );
    // A published collection can only be withdrawn, never deleted.
    await expect(curator.getByRole("button", { name: "Usuń szkic" })).toHaveCount(0);
    await curator.getByRole("button", { name: "Wycofaj publikację" }).click();
    await expect(
      curator.getByRole("status").filter({ hasText: "Publikacja wycofana" }),
    ).toBeVisible();
    await expect(curator.getByRole("button", { name: "Usuń szkic" })).toHaveCount(0);

    // The place editor.
    await curator.getByRole("link", { name: "Drugie miejsce" }).click();
    await expect(curator.getByRole("heading", { level: 1, name: "Drugie miejsce" })).toBeVisible();
    await curator.getByLabel("Promień potwierdzania wizyty (m)").fill("20");
    await curator.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(curator.locator("main [role=alert]")).toContainText("Popraw zaznaczone pola");
    await expect(
      curator.locator("main [role=alert]").getByRole("link", { name: /Promień/ }),
    ).toBeVisible();
    await curator.getByLabel("Promień potwierdzania wizyty (m)").fill("300");
    await curator.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(
      curator.getByRole("status").filter({ hasText: "Zapisano zmiany miejsca." }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(curator);

    await curator.context().close();
  });

  test("a draft that was never published can be deleted after confirmation", async ({
    browser,
  }) => {
    const curator = await signedInPage(browser, "curator-a");
    const title = `Do usunięcia ${Date.now()}`;

    await createDraft(curator, title);
    await curator.getByRole("button", { name: "Usuń szkic" }).click();
    await curator.getByRole("dialog").getByRole("button", { name: "Usuń szkic" }).click();
    await expect(curator).toHaveURL(/\/curator$/);
    await expect(curator.getByRole("link", { name: title })).toHaveCount(0);
    await curator.context().close();
  });

  test("curator A does not see the drafts of curator B, and B does not see those of A", async ({
    browser,
  }) => {
    const a = await signedInPage(browser, "curator-a");
    const b = await signedInPage(browser, "curator-b");
    const titleA = `Szkic organizacji A ${Date.now()}`;
    const titleB = `Szkic organizacji B ${Date.now()}`;
    const pathA = await createDraft(a, titleA);
    const pathB = await createDraft(b, titleB);

    // Lists: each sees only the own draft.
    await a.goto("/curator");
    await expect(a.getByRole("link", { name: titleA })).toBeVisible();
    await expect(a.getByRole("link", { name: titleB })).toHaveCount(0);
    await b.goto("/curator");
    await expect(b.getByRole("link", { name: titleB })).toBeVisible();
    await expect(b.getByRole("link", { name: titleA })).toHaveCount(0);

    // Editors: a foreign draft is the same "not found" as a missing one.
    await b.goto(pathA);
    await expect(b.getByRole("heading", { level: 1, name: "Nie znaleziono" })).toBeVisible();
    await expect(b.getByText(titleA)).toHaveCount(0);
    await a.goto(pathB);
    await expect(a.getByRole("heading", { level: 1, name: "Nie znaleziono" })).toBeVisible();
    await a.goto(`/curator/collections/00000000-0000-4000-8000-000000000000`);
    await expect(a.getByRole("heading", { level: 1, name: "Nie znaleziono" })).toBeVisible();

    // The routes behind the screens answer 404 and change nothing.
    const collectionId = pathA.split("/").pop();
    const patch = await b.request.patch(`/api/curator/collections/${collectionId}`, {
      data: { version: 1, title: "Przejęta" },
      headers: { Origin: new URL(b.url()).origin },
    });

    expect(patch.status()).toBe(404);
    await a.goto(pathA);
    await expect(a.getByRole("heading", { level: 1, name: titleA })).toBeVisible();

    await a.context().close();
    await b.context().close();
  });
});
