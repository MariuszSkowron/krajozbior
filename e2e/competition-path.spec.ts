import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";

// The whole competition path, end to end (spec sections 1 and 8, PR7): curator
// A builds and publishes a collection, a guest reads it, an explorer saves it,
// confirms a visit on site and sees 1/1 in "Moje kolekcje"; curator B is
// refused on the draft of A. Needs a migrated, seeded database like the other
// specs that sign in; without it the spec is skipped.
const password = process.env.DEMO_ACCOUNT_PASSWORD;

const EXPLORER = "user@demo.krajozbior.local";
const emailOf = (name: string) => `${name}@demo.krajozbior.local`;
const BRIDGE = { latitude: 54.0928, longitude: 18.7919 };

async function signedInPage(browser: Browser, name: string, geolocation = false): Promise<Page> {
  const context = await browser.newContext(
    geolocation ? { permissions: ["geolocation"], geolocation: { ...BRIDGE, accuracy: 15 } } : {},
  );
  const page = await context.newPage();

  await page.goto("/login");

  const form = page.locator("form", { has: page.getByLabel("Hasło") });

  await form.getByLabel("E-mail").fill(emailOf(name));
  await form.getByLabel("Hasło").fill(password ?? "");
  await form.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/my$/);

  return page;
}

async function adminQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });

  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

// What the test created is removed straight in the database afterwards (a
// published collection cannot be deleted through the app, D-15).
const created = { title: "", collectionId: "" };

async function cleanUp() {
  await adminQuery(
    `delete from public.visits where user_id in (select id from auth.users where email = $1)`,
    [EXPLORER],
  );
  await adminQuery(
    `delete from public.saved_collections where user_id in (select id from auth.users where email = $1)`,
    [EXPLORER],
  );
  await adminQuery(
    `delete from public.want_to_see_places where user_id in (select id from auth.users where email = $1)`,
    [EXPLORER],
  );

  if (created.collectionId === "") {
    return;
  }

  const places = await adminQuery<{ place_id: string }>(
    `select place_id from public.collection_places where collection_id = $1`,
    [created.collectionId],
  );

  await adminQuery(`delete from public.visits where place_id = any($1::uuid[])`, [
    places.map((p) => p.place_id),
  ]);
  await adminQuery(`delete from public.collection_places where collection_id = $1`, [
    created.collectionId,
  ]);
  await adminQuery(`delete from public.collections where id = $1`, [created.collectionId]);
  await adminQuery(`delete from public.places where id = any($1::uuid[])`, [
    places.map((p) => p.place_id),
  ]);
  created.collectionId = "";
}

test.describe("the competition path", () => {
  test.skip(!password, "DEMO_ACCOUNT_PASSWORD and a migrated, seeded database are required");

  test.beforeEach(cleanUp);
  test.afterEach(cleanUp);

  test("curator A publishes, a guest reads, an explorer saves and visits, B is refused", async ({
    browser,
    page: guest,
  }) => {
    const title = `Ścieżka konkursowa ${Date.now()}`;
    const curatorA = await signedInPage(browser, "curator-a");
    const curatorB = await signedInPage(browser, "curator-b");

    // Curator A: a draft with one place at the bridge.
    await curatorA.goto("/curator");
    await curatorA.getByRole("link", { name: "Nowa kolekcja" }).click();
    await curatorA.waitForLoadState("networkidle");
    await curatorA.getByLabel("Nazwa", { exact: true }).fill(title);
    await curatorA.getByLabel("Krótki opis").fill("Kolekcja z testu całej ścieżki.");
    await curatorA.getByRole("button", { name: "Utwórz szkic kolekcji" }).click();
    await expect(curatorA.getByRole("heading", { level: 1, name: title })).toBeVisible();

    const editorPath = new URL(curatorA.url()).pathname;

    created.title = title;
    created.collectionId = editorPath.split("/").pop() ?? "";

    await curatorA.getByRole("link", { name: "Dodaj nowe miejsce" }).click();
    await expect(curatorA.getByRole("heading", { level: 1, name: "Nowe miejsce" })).toBeVisible();
    await curatorA.waitForLoadState("networkidle");
    await curatorA.getByLabel("Nazwa", { exact: true }).fill("Most ze ścieżki");
    await curatorA.getByLabel("Adres", { exact: true }).fill("Tczew");
    await curatorA.getByLabel("Szerokość geograficzna").fill("54,0928");
    await curatorA.getByLabel("Długość geograficzna").fill("18.7919");
    await curatorA.getByRole("button", { name: "Dodaj miejsce do kolekcji" }).click();
    await expect(curatorA).toHaveURL(new RegExp(`${editorPath}$`));

    const placeHref = await curatorA
      .getByRole("link", { name: "Most ze ścieżki" })
      .getAttribute("href");
    const placeId = (placeHref ?? "").split("/").pop() ?? "";

    expect(placeId).toMatch(/^[0-9a-f-]{36}$/);

    // The draft is private: B gets "not found" on the editor and on the visit route.
    await curatorB.goto(editorPath);
    await expect(curatorB.getByRole("heading", { level: 1, name: "Nie znaleziono" })).toBeVisible();
    const refused = await curatorB.request.post(`/api/places/${placeId}/visits`, {
      data: {
        ...BRIDGE,
        accuracy: 15,
        clientVisitId: "66666666-6666-4666-8666-666666666666",
      },
      headers: { origin: new URL(curatorB.url()).origin },
    });

    expect(refused.status()).toBe(404);

    // Publication.
    await curatorA.getByRole("button", { name: "Publikuj" }).click();
    await expect(curatorA.getByRole("status").filter({ hasText: "opublikowana" })).toBeVisible();

    // A guest reads the collection and the place without signing in.
    const [{ slug }] = await adminQuery<{ slug: string }>(
      `select slug from public.collections where id = $1`,
      [created.collectionId],
    );

    await guest.goto(`/collections/${slug}`);
    await expect(guest.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await guest.getByRole("link", { name: /Most ze ścieżki/ }).click();
    await expect(guest.getByRole("heading", { level: 1, name: "Most ze ścieżki" })).toBeVisible();
    await expect(
      guest.getByRole("link", { name: "Zaloguj się, aby potwierdzić wizytę" }),
    ).toBeVisible();
    await expect(
      guest.getByRole("link", { name: "Zaloguj się, aby zapisać na Chcę zobaczyć" }),
    ).toBeVisible();

    // The explorer saves it, sees 0/1, confirms the visit on site and sees 1/1.
    const explorer = await signedInPage(browser, "user", true);

    await explorer.goto(`/collections/${slug}`);
    await explorer.waitForLoadState("networkidle");
    await explorer.getByRole("button", { name: "Zapisz kolekcję" }).click();
    await expect(explorer.getByRole("button", { name: "Usuń z zapisanych" })).toBeVisible();
    await explorer.goto("/my/collections");
    await expect(explorer.getByRole("link", { name: title })).toContainText("0/1 odwiedzone");

    // "Chcę zobaczyć" (PR8): the explorer puts the place on the list and finds it there.
    await explorer.goto(`/places/${placeId}`);
    await explorer.waitForLoadState("networkidle");
    await explorer.getByRole("button", { name: "Chcę zobaczyć", exact: true }).click();
    await expect(
      explorer.getByText("To miejsce jest na Twojej liście „Chcę zobaczyć”."),
    ).toBeVisible();
    await explorer.goto("/my/want-to-see");
    await expect(explorer.getByRole("link", { name: /Most ze ścieżki/ })).toContainText(
      "Zapisano:",
    );

    await explorer.goto(`/places/${placeId}`);
    await explorer.waitForLoadState("networkidle");
    await explorer.getByRole("button", { name: "Potwierdź wizytę" }).click();
    await expect(explorer.getByText("Wizyta potwierdzona.")).toBeVisible();
    await expect(explorer.getByRole("list", { name: "Twój postęp po tej wizycie" })).toContainText(
      "1/1",
    );

    await explorer.goto("/my/collections");
    await expect(explorer.getByRole("link", { name: title })).toContainText("1/1 odwiedzone");

    // Curator A has no way to see who visited: the app has no such page or route.
    const noRoute = await curatorA.request.get(`/api/places/${placeId}/visits`);

    expect(noRoute.status()).toBe(405);

    for (const context of [curatorA, curatorB, explorer]) {
      await context.context().close();
    }
  });
});
