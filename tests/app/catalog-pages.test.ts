import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collection: vi.fn(),
  place: vi.fn(),
  actor: vi.fn(),
  visited: vi.fn(),
  kinds: vi.fn(),
  progress: vi.fn(),
  wanted: vi.fn(),
}));

vi.mock("@/features/catalog/application/public-catalog", () => ({
  getPublishedCollection: mocks.collection,
  getPublishedPlace: mocks.place,
}));
vi.mock("@/features/catalog/infrastructure/catalog-deps", () => ({ getCatalogDeps: () => ({}) }));
vi.mock("@/app/request-actor", () => ({
  logReadFailure: vi.fn(),
  getRequestActor: mocks.actor,
  loginHref: (path: string) => `/login?returnTo=${encodeURIComponent(path)}`,
}));
vi.mock("@/features/visits/application/mark-past-visits", () => ({
  getMyVisitOfPlace: mocks.visited,
  listMyVisitKindsOfCollection: mocks.kinds,
}));
vi.mock("@/features/album/application/saved-collections", () => ({
  getCollectionProgress: mocks.progress,
}));
vi.mock("@/features/album/infrastructure/album-deps", () => ({ getAlbumDeps: () => ({}) }));
// The client parts need an app router only for `router.refresh()` after a click.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/features/visits/infrastructure/visit-deps", () => ({ getVisitDeps: () => ({}) }));
vi.mock("@/features/want-to-see/application/want-to-see", () => ({ isWantedPlace: mocks.wanted }));
vi.mock("@/features/want-to-see/infrastructure/want-to-see-deps", () => ({
  getWantToSeeDeps: () => ({}),
}));

const { CatalogError } = await import("@/app/catalog-error");
const collectionPage = await import("@/app/collections/[slug]/page");
const placePage = await import("@/app/places/[placeId]/page");

const placeId = "22222222-2222-4222-8222-222222222222";

const collection = {
  id: "c1",
  slug: "kolekcja-a1b2c3",
  title: "Wieże <Tczewa>",
  summary: "Krótki opis",
  region: "pomorskie",
  organization: { name: "Gmina A", slug: "gmina-a" },
  places: [
    { id: placeId, name: "Most", address: "Tczew", position: 1, latitude: 54.09, longitude: 18.79 },
  ],
  placeCount: 1,
  contentUpdatedAt: new Date("2026-11-18T10:00:00Z"),
  cover: null,
};

const place = {
  id: placeId,
  name: "Most Tczewski",
  description: "Opis",
  address: "Tczew",
  accessInfo: "Od rynku",
  latitude: 54,
  longitude: 18,
  visitRadiusM: 200,
  organization: { name: "Gmina A", slug: "gmina-a" },
  collections: [{ slug: "kolekcja-a1b2c3", title: "Wieże Tczewa" }],
  source: null,
  cover: null,
};

// Each case uses its own address: the pages read through React's per-request cache.
let counter = 0;
const next = () => `adres-${(counter += 1)}`;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.collection.mockReset();
  mocks.place.mockReset();
  mocks.visited.mockReset();
  mocks.kinds.mockReset();
  mocks.progress.mockReset();
  mocks.wanted.mockReset();
  // Default: the session lookup fails, so the page shows only the public part.
  mocks.actor.mockReset().mockRejectedValue(new Error("no session"));
});

describe("public catalog pages", () => {
  it("are rendered on every request", () => {
    expect(collectionPage.dynamic).toBe("force-dynamic");
    expect(placePage.dynamic).toBe("force-dynamic");
  });

  it("show a collection with region, organization and places linking to place pages", async () => {
    mocks.collection.mockResolvedValue({ status: "ok", value: collection });

    const html = renderToStaticMarkup(
      await collectionPage.default({ params: Promise.resolve({ slug: next() }) }),
    );

    expect(html).toContain("Wieże &lt;Tczewa&gt;");
    expect(html).toContain("Kolekcja · Pomorskie");
    expect(html).toContain("Kurator: Gmina A");
    expect(html).toContain("1 miejsce · aktualizacja 18.11.2026");
    expect(html).toContain(`href="/places/${placeId}"`);
    expect(html).toContain("Miejsca w kolekcji (1)");
  });

  it("title a collection page with its name, and a missing one with nothing", async () => {
    mocks.collection.mockResolvedValueOnce({ status: "ok", value: collection });
    expect(
      await collectionPage.generateMetadata({ params: Promise.resolve({ slug: next() }) }),
    ).toEqual({
      title: "Wieże <Tczewa> — Krajozbiór",
    });

    mocks.collection.mockResolvedValueOnce({ status: "not_found" });
    expect(
      await collectionPage.generateMetadata({ params: Promise.resolve({ slug: next() }) }),
    ).toEqual({});
  });

  it("answer a missing collection and a missing place with the 404 page", async () => {
    mocks.collection.mockResolvedValue({ status: "not_found" });
    mocks.place.mockResolvedValue({ status: "not_found" });

    await expect(
      collectionPage.default({ params: Promise.resolve({ slug: next() }) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await expect(
      placePage.default({ params: Promise.resolve({ placeId: next() }) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("throw on a database failure, to the error boundary (a server error, not a 404)", async () => {
    mocks.collection.mockRejectedValue(new Error("db down"));
    mocks.place.mockRejectedValue(new Error("db down"));

    const collectionError = await collectionPage
      .default({ params: Promise.resolve({ slug: next() }) })
      .catch((error: unknown) => error);
    const placeError = await placePage
      .default({ params: Promise.resolve({ placeId: next() }) })
      .catch((error: unknown) => error);

    // A plain error: not the `notFound()` error, which carries a digest.
    expect(collectionError).toBeInstanceOf(Error);
    expect(collectionError).not.toHaveProperty("digest");
    expect(placeError).toBeInstanceOf(Error);
    expect(placeError).not.toHaveProperty("digest");
    expect(
      await placePage.generateMetadata({ params: Promise.resolve({ placeId: next() }) }),
    ).toEqual({});
  });

  it("show the error boundary as a Polish alert without technical details", () => {
    const html = renderToStaticMarkup(createElement(CatalogError, { retry: () => undefined }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("Spróbuj ponownie za chwilę");
    expect(html).toContain("Spróbuj ponownie</button>");
    expect(html).not.toContain("db down");
  });

  it("show the cover of a place with its credit, and no photo block without one (E4-2b)", async () => {
    const cover = {
      photoId: "0b6f3a52-7c41-4b7e-9d0a-1c2d3e4f5a6b",
      width: 1280,
      height: 853,
      altText: "Most Tczewski",
      title: null,
      authorText: "Fikcyjny Autor",
      authorUrl: null,
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Most.jpg",
      sourceKind: "commons_import",
      licenseCode: "cc-by-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      licenseLabel: "CC BY 4.0",
    };

    mocks.place.mockResolvedValueOnce({ status: "ok", value: { ...place, cover } });

    const withCover = renderToStaticMarkup(
      await placePage.default({ params: Promise.resolve({ placeId: next() }) }),
    );

    expect(withCover).toContain(`/media/p/${cover.photoId}/main`);
    expect(withCover).toContain("Autor: Fikcyjny Autor");
    expect(withCover).toContain(">CC BY 4.0</a>");

    mocks.place.mockResolvedValueOnce({ status: "ok", value: place });

    const without = renderToStaticMarkup(
      await placePage.default({ params: Promise.resolve({ placeId: next() }) }),
    );

    expect(without).not.toContain("<figure");
    expect(without).not.toContain("/media/p/");
  });

  it("say so when a collection has no places yet", async () => {
    mocks.collection.mockResolvedValue({ status: "ok", value: { ...collection, places: [] } });

    const html = renderToStaticMarkup(
      await collectionPage.default({ params: Promise.resolve({ slug: next() }) }),
    );

    expect(html).toContain("Ta kolekcja nie ma jeszcze miejsc.");
    expect(html).not.toContain("(0)");
    expect(html).not.toContain("<ol");
  });

  it("say so, in short Polish, when the album read fails, and keep the rest of the page", async () => {
    mocks.collection.mockResolvedValue({ status: "ok", value: collection });

    const html = renderToStaticMarkup(
      await collectionPage.default({ params: Promise.resolve({ slug: next() }) }),
    );

    // getRequestActor is not mocked here, so the personal read throws.
    expect(html).toContain("Nie udało się wczytać Twojego zapisu tej kolekcji.");
    expect(html).not.toContain("Zapisz kolekcję");
    expect(html).toContain("Miejsca w kolekcji (1)");
  });

  it("show a place with address, access, description and its collections", async () => {
    mocks.place.mockResolvedValue({ status: "ok", value: place });

    const html = renderToStaticMarkup(
      await placePage.default({ params: Promise.resolve({ placeId: next() }) }),
    );

    expect(html).toContain("Most Tczewski");
    expect(html).toContain("Od rynku");
    expect(html).toContain('href="/collections/kolekcja-a1b2c3"');
    expect(
      await placePage.generateMetadata({ params: Promise.resolve({ placeId: next() }) }),
    ).toEqual({ title: "Most Tczewski — Krajozbiór" });
  });

  describe("the sources line of a place page", () => {
    const render = async () =>
      renderToStaticMarkup(
        await placePage.default({ params: Promise.resolve({ placeId: next() }) }),
      );

    it("shows the signature, the licence page and the links when the place has sources", async () => {
      mocks.place.mockResolvedValue({
        status: "ok",
        value: {
          ...place,
          source: {
            attribution: "Źródło testowe A (CC BY 4.0)",
            wikipediaUrl: "https://pl.wikipedia.org/wiki/Most_Tczewski",
            wikidataQid: "Q123",
          },
        },
      });

      const html = await render();

      expect(html).toContain("Źródło testowe A (CC BY 4.0)");
      expect(html).toContain('href="/zrodla"');
      expect(html).toContain('href="https://pl.wikipedia.org/wiki/Most_Tczewski"');
      expect(html).toContain('href="https://www.wikidata.org/wiki/Q123"');
    });

    it("leaves out the links the place does not have", async () => {
      mocks.place.mockResolvedValue({
        status: "ok",
        value: {
          ...place,
          source: { attribution: "Dane własne", wikipediaUrl: null, wikidataQid: null },
        },
      });

      const html = await render();

      expect(html).toContain("Dane własne");
      expect(html).not.toContain("Więcej w Wikipedii");
      expect(html).not.toContain("Wikidanych");
    });

    it("renders no empty list when the place has neither link", async () => {
      const { PlaceSources } = await import("@/app/places/[placeId]/place-sources");
      const source = { attribution: "Dane własne", wikipediaUrl: null, wikidataQid: null };

      expect(renderToStaticMarkup(createElement(PlaceSources, { source }))).not.toContain("<ul");
    });

    it("takes the heading level from the place it is shown in", async () => {
      const { PlaceSources } = await import("@/app/places/[placeId]/place-sources");
      const source = { attribution: "Dane własne", wikipediaUrl: null, wikidataQid: null };

      expect(renderToStaticMarkup(createElement(PlaceSources, { source }))).toContain("<h2");
      expect(
        renderToStaticMarkup(createElement(PlaceSources, { source, headingLevel: 3 })),
      ).toContain("<h3");
    });

    it("shows no sources section for a place without a source row", async () => {
      mocks.place.mockResolvedValue({ status: "ok", value: place });

      expect(await render()).not.toContain("Licencje i szczegóły");
    });
  });

  describe("the visit part of a place page", () => {
    const explorer = { id: "u1", role: "user" };
    const none = { onSite: false, past: null };
    const onSite = { onSite: true, past: null };
    const render = async () =>
      renderToStaticMarkup(
        await placePage.default({ params: Promise.resolve({ placeId: next() }) }),
      );

    beforeEach(() => {
      mocks.place.mockResolvedValue({ status: "ok", value: place });
      mocks.actor.mockResolvedValue(explorer);
    });

    it("gives a guest one sign-in link with the note about coming back", async () => {
      mocks.actor.mockResolvedValue(null);

      const html = await render();

      expect(html.match(/Zaloguj się, aby/g)).toHaveLength(1);
      expect(html).toContain("Zaloguj się, aby potwierdzić wizytę lub zapisać na Chcę zobaczyć");
      expect(html).toContain("Po zalogowaniu wrócisz na tę stronę.");
    });

    it("lets an explorer remove a visited place from the list (W1)", async () => {
      mocks.visited.mockResolvedValue({ status: "ok", value: onSite });
      mocks.wanted.mockResolvedValue({ status: "ok", value: { wanted: true } });

      const html = await render();

      expect(html).toContain("Masz już zapisaną wizytę w tym miejscu.");
      expect(html).toContain("Usuń z Chcę zobaczyć");
      expect(html).not.toContain("Potwierdź wizytę");
    });

    it("shows nothing about the list for a visited place that is not on it", async () => {
      mocks.visited.mockResolvedValue({ status: "ok", value: onSite });
      mocks.wanted.mockResolvedValue({ status: "ok", value: { wanted: false } });

      const html = await render();

      expect(html).toContain("Masz już zapisaną wizytę w tym miejscu.");
      expect(html).not.toContain("Chcę zobaczyć");
    });

    it("keeps the visit button when only the read of the list fails (D1)", async () => {
      mocks.visited.mockResolvedValue({ status: "ok", value: none });
      mocks.wanted.mockRejectedValue(new Error("db down"));

      const html = await render();

      expect(html).toContain("Potwierdź wizytę");
      expect(html).toContain("Lista „Chcę zobaczyć” jest chwilowo niedostępna.");
      expect(html).not.toContain(">Chcę zobaczyć<");
    });

    it("keeps the visit button when the list answers with a refusal", async () => {
      mocks.visited.mockResolvedValue({ status: "ok", value: none });
      mocks.wanted.mockResolvedValue({ status: "unauthenticated" });

      const html = await render();

      expect(html).toContain("Potwierdź wizytę");
      expect(html).toContain("chwilowo niedostępna");
    });

    it("offers 'Byłem tu wcześniej' to an explorer without a visit, outside the pinned button", async () => {
      mocks.visited.mockResolvedValue({ status: "ok", value: none });
      mocks.wanted.mockResolvedValue({ status: "ok", value: { wanted: false } });

      const html = await render();

      expect(html).toContain("Byłem tu wcześniej");
      expect(html).not.toContain("Usuń wizytę z przeszłości");
    });

    it("with only a visit from the past: shows when, keeps the confirm button, offers to take it back", async () => {
      mocks.visited.mockResolvedValue({
        status: "ok",
        value: { onSite: false, past: { precision: "month", visitedOn: "2019-03-01" } },
      });
      mocks.wanted.mockResolvedValue({ status: "ok", value: { wanted: false } });

      const html = await render();

      expect(html).toContain("Z przeszłości · marzec 2019");
      expect(html).toContain("Potwierdź wizytę");
      expect(html).toContain("Potwierdź na miejscu, gdy tu będziesz.");
      expect(html).toContain("Usuń wizytę z przeszłości");
      expect(html).not.toContain("Byłem tu wcześniej");
      expect(html).not.toContain("Masz już zapisaną wizytę");
    });

    it("a visit on site wins over one from the past: only 'Odwiedzone'", async () => {
      mocks.visited.mockResolvedValue({
        status: "ok",
        value: { onSite: true, past: { precision: "year", visitedOn: "2018-01-01" } },
      });
      mocks.wanted.mockResolvedValue({ status: "ok", value: { wanted: false } });

      const html = await render();

      expect(html).toContain("Masz już zapisaną wizytę w tym miejscu.");
      expect(html).not.toContain("Z przeszłości");
      expect(html).not.toContain("Usuń wizytę z przeszłości");
    });
  });

  describe("the places of a collection for an explorer", () => {
    const second = {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Zamek",
      address: "",
      position: 2,
    };
    const third = {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Brama",
      address: "",
      position: 3,
    };
    const render = async () =>
      renderToStaticMarkup(
        await collectionPage.default({ params: Promise.resolve({ slug: next() }) }),
      );

    beforeEach(() => {
      mocks.collection.mockResolvedValue({
        status: "ok",
        value: { ...collection, places: [...collection.places, second, third] },
      });
      mocks.actor.mockResolvedValue({ id: "u1", role: "user" });
      mocks.progress.mockResolvedValue({
        status: "ok",
        value: { saved: true, progress: { visited: 1, total: 3 } },
      });
    });

    it("marks the kind of each visit and offers to choose the places", async () => {
      mocks.kinds.mockResolvedValue({
        status: "ok",
        value: [
          { placeId: placeId, kind: "on_site" },
          { placeId: second.id, kind: "past" },
        ],
      });

      const html = await render();

      expect(html).toContain("Zaznacz odwiedzone");
      // The badges on the cards (the filter link "Odwiedzone" is followed by its count).
      expect(html.match(/>Odwiedzone<\/span>/g)).toHaveLength(1);
      expect(html.match(/>Z przeszłości<\/span>/g)).toHaveLength(1);
    });

    it("offers no choice when every place has a visit", async () => {
      mocks.kinds.mockResolvedValue({
        status: "ok",
        value: [placeId, second.id, third.id].map((id) => ({ placeId: id, kind: "past" })),
      });

      expect(await render()).not.toContain("Zaznacz odwiedzone");
    });

    it("keeps the plain list when the read of the kinds fails", async () => {
      mocks.kinds.mockRejectedValue(new Error("db down"));

      const html = await render();

      expect(html).toContain("Miejsca w kolekcji (3)");
      expect(html).not.toContain("Zaznacz odwiedzone");
    });

    it("keeps the plain list when the read of the kinds is refused", async () => {
      mocks.kinds.mockResolvedValue({ status: "unauthenticated" });

      expect(await render()).not.toContain("Zaznacz odwiedzone");
    });
  });

  it("leave out empty optional fields", async () => {
    mocks.collection.mockResolvedValue({
      status: "ok",
      value: { ...collection, summary: "", places: [{ ...collection.places[0], address: "" }] },
    });
    mocks.place.mockResolvedValue({
      status: "ok",
      value: { ...place, address: "", accessInfo: "", description: "" },
    });

    const collectionHtml = renderToStaticMarkup(
      await collectionPage.default({ params: Promise.resolve({ slug: next() }) }),
    );
    const placeHtml = renderToStaticMarkup(
      await placePage.default({ params: Promise.resolve({ placeId: next() }) }),
    );

    expect(collectionHtml).not.toContain("Tczew<");
    expect(placeHtml).not.toContain("<dt>");
  });

  // E12-4: the collection as an album: filter of the state, selected place, panel.
  describe("the album view of a collection", () => {
    const second = {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Zamek",
      address: "Gniew",
      position: 2,
    };
    const third = {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Brama",
      address: "",
      position: 3,
    };
    const outsider = "55555555-5555-4555-8555-555555555555";
    const render = async (query: Record<string, string | string[] | undefined> = {}) =>
      renderToStaticMarkup(
        await collectionPage.default({
          params: Promise.resolve({ slug: next() }),
          searchParams: Promise.resolve(query),
        }),
      );
    const kindsOf = (visits: [string, "on_site" | "past"][]) => ({
      status: "ok",
      value: visits.map(([id, kind]) => ({ placeId: id, kind })),
    });

    beforeEach(() => {
      mocks.collection.mockResolvedValue({
        status: "ok",
        value: {
          ...collection,
          places: [...collection.places, second, third],
          placeCount: 3,
        },
      });
      mocks.place.mockResolvedValue({ status: "ok", value: { ...place, id: second.id } });
    });

    describe("for an explorer", () => {
      beforeEach(() => {
        mocks.actor.mockResolvedValue({ id: "u1", role: "user" });
        mocks.progress.mockResolvedValue({
          status: "ok",
          value: { saved: true, progress: { kind: "progress", visited: 2, total: 3 } },
        });
        mocks.kinds.mockResolvedValue(
          kindsOf([
            [placeId, "on_site"],
            [third.id, "past"],
          ]),
        );
        mocks.wanted.mockResolvedValue({ status: "ok", value: { wanted: false } });
      });

      it("shows the filter with counts and marks the chosen one", async () => {
        const html = await render();

        expect(html).toContain('aria-label="Filtr miejsc"');
        expect(html).toMatch(/Wszystkie<span[^>]*>\(3\)<\/span>/);
        expect(html).toMatch(/Odwiedzone<span[^>]*>\(2\)<\/span>/);
        expect(html).toMatch(/Do odwiedzenia<span[^>]*>\(1\)<\/span>/);
        expect(html).toMatch(/href="\/collections\/kolekcja-a1b2c3\?stan=odwiedzone"/);
        // One chosen item in the view switch (Karty) and one in the filter (Wszystkie).
        expect(html.match(/aria-current="page"/g)).toHaveLength(2);
        expect(html).toMatch(/aria-current="page"[^>]*>Wszystkie/);
        expect(html).toMatch(/aria-current="page"[^>]*>Karty/);
        expect(html).toContain('aria-label="Widok miejsc"');
        expect(html).toMatch(/href="\/collections\/kolekcja-a1b2c3\?widok=mapa"/);
      });

      it("lists only the places of the chosen state, with their numbers", async () => {
        const html = await render({ stan: "do-odwiedzenia" });

        expect(html).toMatch(/aria-current="page"[^>]*>Do odwiedzenia/);
        expect(html).toContain("Zamek");
        expect(html).not.toContain("Brama");
        expect(html).not.toContain(">Most<");
        expect(html).toContain("Miejsca w kolekcji (3)");
      });

      it("reads an unknown state as the whole list", async () => {
        const html = await render({ stan: "cokolwiek" });

        expect(html).toMatch(/aria-current="page"[^>]*>Wszystkie/);
        expect(html).toContain("Brama");
        expect(html).toContain("Zamek");
      });

      it("says so when the filter leaves nothing", async () => {
        mocks.kinds.mockResolvedValue(
          kindsOf([
            [placeId, "on_site"],
            [second.id, "past"],
            [third.id, "past"],
          ]),
        );

        const html = await render({ stan: "do-odwiedzenia" });

        expect(html).toContain("Żadne miejsce nie pasuje do tego filtra.");
        expect(html).not.toContain("Zaznacz odwiedzone");
      });

      it("keeps a card a plain link to the place page (works without JavaScript)", async () => {
        const html = await render({ stan: "do-odwiedzenia" });

        expect(html).toContain(`href="/places/${second.id}"`);
      });

      it("shows the panel of the chosen place with the state of the visit and the list button", async () => {
        const html = await render({ miejsce: second.id });

        expect(html).toContain('aria-labelledby="panel-miejsca"');
        expect(html).toMatch(/<h2 id="panel-miejsca" aria-live="polite">Most Tczewski<\/h2>/);
        expect(html).toContain("Do odwiedzenia</span>");
        expect(html).toContain("Od rynku");
        expect(html).toContain("Chcę zobaczyć");
        expect(html).toMatch(new RegExp(`href="/places/${second.id}"[^>]*>Otwórz stronę miejsca`));
        expect(html.match(/aria-current="true"/g)).toHaveLength(1);
      });

      it("shows the kind of the visit of the chosen place in the panel", async () => {
        const html = await render({ miejsce: third.id });

        expect(html).toMatch(
          /<h2 id="panel-miejsca"[^>]*>Most Tczewski<\/h2><p><span[^>]*>Z przeszłości/,
        );
      });

      it("leaves out the list button of a visited place that is not on the list", async () => {
        const html = await render({ miejsce: placeId });

        expect(html).toContain("Otwórz stronę miejsca");
        expect(html).not.toContain("Chcę zobaczyć");
      });

      it("leaves out only the list button when the read of the list fails", async () => {
        mocks.wanted.mockRejectedValue(new Error("db down"));

        const html = await render({ miejsce: second.id });

        expect(html).toContain("Otwórz stronę miejsca");
        expect(html).not.toContain("Chcę zobaczyć");
      });

      it("leaves out the list button of the panel when the read of the visits fails (as the place page)", async () => {
        mocks.kinds.mockRejectedValue(new Error("db down"));
        mocks.wanted.mockResolvedValue({ status: "ok", value: { wanted: false } });

        const html = await render({ miejsce: second.id });

        expect(html).toContain("Otwórz stronę miejsca");
        expect(html).not.toContain("Chcę zobaczyć");
      });

      it("gives no panel for a place outside the collection, or for a bad value, and no error", async () => {
        for (const value of [outsider, "nie-uuid", ["x", "y"]]) {
          const html = await render({ miejsce: value });

          expect(html).toContain("Wybierz kartę miejsca");
          expect(html).not.toContain("Otwórz stronę miejsca");
          expect(html).not.toContain('aria-current="true"');
        }

        expect(mocks.place).not.toHaveBeenCalled();
      });

      it("keeps the page and says so in the panel when the read of the place fails", async () => {
        mocks.place.mockRejectedValue(new Error("db down"));

        const html = await render({ miejsce: second.id });

        expect(html).toContain("Nie udało się wczytać miejsca");
        expect(html).toContain("Miejsca w kolekcji (3)");
      });

      it("shows the empty panel when the place is gone from the public catalog", async () => {
        mocks.place.mockResolvedValue({ status: "not_found" });

        expect(await render({ miejsce: second.id })).toContain("Wybierz kartę miejsca");
      });

      it("keeps the selection of the places of the past visits (checkboxes) in the list", async () => {
        const html = await render();

        expect(html).toContain("Zaznacz odwiedzone");
      });

      it("shortens a long description in the panel", async () => {
        mocks.place.mockResolvedValue({
          status: "ok",
          value: { ...place, id: second.id, description: "słowo ".repeat(200) },
        });

        const html = await render({ miejsce: second.id });

        expect(html).toContain("…");
        expect(html.length).toBeLessThan(20000);
        expect(html).not.toContain("słowo ".repeat(100));
      });

      it("has no filter when the read of the kinds fails, and a plain list", async () => {
        mocks.kinds.mockRejectedValue(new Error("db down"));

        const html = await render({ stan: "odwiedzone" });

        expect(html).not.toContain("Filtr miejsc");
        expect(html).toContain("Brama");
        expect(html).toContain("Zamek");
      });
    });

    describe("for a guest", () => {
      beforeEach(() => {
        mocks.actor.mockResolvedValue(null);
      });

      it("has no filter and no state, and links the cards to the places", async () => {
        const html = await render({ stan: "odwiedzone" });

        expect(html).not.toContain("Filtr miejsc");
        expect(html).toContain(`href="/places/${second.id}"`);
        expect(html).toContain("Brama");
        expect(html).toContain("Zapisz kolekcję");
      });

      it("shows the panel with the link to the page of the place and no list button", async () => {
        const html = await render({ miejsce: second.id });

        expect(html).toContain("Otwórz stronę miejsca");
        expect(html).not.toContain("Chcę zobaczyć");
        expect(html).not.toContain("Do odwiedzenia</span>");
        expect(mocks.wanted).not.toHaveBeenCalled();
      });
    });
  });
});
