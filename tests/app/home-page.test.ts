import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  getHomeAlbum: vi.fn(),
  listSaved: vi.fn(),
  listRecent: vi.fn(),
  listNearby: vi.fn(),
  getBanner: vi.fn(),
  getHomeBanner: vi.fn(),
  connection: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: mocks.getActor }),
}));
vi.mock("@/features/album/infrastructure/album-deps", () => ({ getAlbumDeps: () => ({}) }));
vi.mock("@/features/catalog/infrastructure/catalog-deps", () => ({ getCatalogDeps: () => ({}) }));
vi.mock("@/features/profile/infrastructure/profile-deps", () => ({ getProfileDeps: () => ({}) }));
vi.mock("@/features/profile/application/profile", () => ({ getMyProfile: mocks.getProfile }));
vi.mock("@/features/album/application/home-album", () => ({ getHomeAlbum: mocks.getHomeAlbum }));
vi.mock("@/features/album/application/saved-collections", () => ({
  listMySavedCollectionSlugs: mocks.listSaved,
}));
vi.mock("@/features/catalog/application/public-catalog", () => ({
  listRecentlyPublishedCollections: mocks.listRecent,
  listNearbyCandidates: mocks.listNearby,
  getCollectionBanner: mocks.getBanner,
  getHomeBanner: mocks.getHomeBanner,
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));

const { default: HomePage } = await import("@/app/page");

const id = "11111111-1111-4111-8111-111111111111";

type Search = Record<string, string | string[] | undefined>;

async function render(search: Search = {}): Promise<string> {
  return renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve(search) }));
}

const discover = [
  {
    id: "c1",
    slug: "mosty-i-zamki",
    title: "Mosty i zamki",
    region: "pomorskie",
    organization: { name: "Gmina A" },
    placeCount: 3,
    cover: null,
  },
];

const coverOf = (photoId: string) => ({ photoId, width: 1600, height: 1000, altText: "Zamek" });

const banner = {
  ...coverOf("ph1"),
  title: null,
  authorText: "Jan Autor",
  authorUrl: null,
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Zamek.jpg",
  sourceKind: "commons_import",
  licenseCode: "cc-by-sa-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  licenseLabel: "CC BY-SA 4.0",
  placeId: "p9",
  placeName: "Zamek w Płotach",
};

const nearby = [
  {
    slug: "mosty-i-zamki",
    title: "Mosty i zamki",
    region: "pomorskie",
    placeCount: 3,
    centerLat: 54.1,
    centerLon: 18.8,
    firstPublishedAt: "2026-11-01T10:00:00.000Z",
  },
];

const album = {
  summary: { discoveredPlaces: 7, regions: 2, savedCollections: 1 },
  favorites: [
    {
      id: "c2",
      slug: "wiezyce",
      title: "Wieżyce",
      region: "lodzkie",
      progress: { kind: "progress", visited: 1, total: 4 },
    },
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `f${i}`,
      slug: `f-${i}`,
      title: `Ulubiona ${i}`,
      region: "lodzkie",
      progress: { kind: "empty" },
    })),
  ],
  recentVisits: [
    {
      id: "v1",
      kind: "past",
      visitedAt: new Date("2026-11-17T12:00:00Z"),
      visitedOn: "2019-03-01",
      precision: "month",
      place: { id: "p1", name: "Wieża ciśnień", address: "Tczew" },
    },
    {
      id: "v2",
      kind: "on_site",
      visitedAt: new Date("2026-11-16T12:00:00Z"),
      visitedOn: null,
      precision: null,
      place: null,
    },
  ],
};

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T10:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getActor.mockReset().mockResolvedValue(null);
  mocks.listRecent.mockReset().mockResolvedValue(discover);
  mocks.listNearby.mockReset().mockResolvedValue(nearby);
  mocks.getBanner.mockReset().mockResolvedValue(null);
  mocks.getHomeBanner.mockReset().mockResolvedValue(null);
  mocks.connection.mockReset().mockResolvedValue(undefined);
  mocks.getHomeAlbum.mockReset().mockResolvedValue({ status: "ok", value: album });
  mocks.listSaved.mockReset().mockResolvedValue({ status: "ok", value: [] });
  mocks.getProfile.mockReset().mockResolvedValue({ status: "ok", value: { firstName: "Anna" } });
});

describe("home page of a guest", () => {
  it("shows the introduction, the login link and the collections to discover", async () => {
    const html = await render();

    expect(html).toMatch(/<h1[^>]*>Odkrywaj miejsca/);
    // "Załóż konto" is the main button, "Zobacz kolekcje" the second; under them the way in
    // for people who already have an account.
    expect(html).toMatch(
      /<a [^>]*class="button button--primary"[^>]*href="\/login\/zaloz-konto"[^>]*>Załóż konto<\/a>/,
    );
    expect(html).toMatch(/<a [^>]*href="#do-odkrycia"[^>]*>Zobacz kolekcje<\/a>/);
    expect(html).toMatch(/Masz już konto\? <a [^>]*href="\/login"[^>]*>Zaloguj się<\/a>/);
    expect(html).not.toContain("ciekawych miejsc");
    expect(html).toContain('id="do-odkrycia"');
    expect(html).toContain("Mosty i zamki");
    expect(html).toContain("3 miejsca · Gmina A");
    expect(html).toContain('href="/collections/mosty-i-zamki"');
    expect(html).not.toContain("Profil");
    expect(html).not.toContain("Odkryte miejsca");
    // E12-2: the search field and the link to all collections.
    expect(html).toMatch(/<form (?=[^>]*action="\/search")(?=[^>]*role="search")/);
    expect(html).toMatch(/<label [^>]*for="home-search-q"[^>]*>Szukaj miejsc i kolekcji<\/label>/);
    expect(html).toMatch(
      /<input [^>]*type="search"[^>]*name="q"|<input [^>]*name="q"[^>]*type="search"/,
    );
    expect(html).not.toContain("<select");
    expect(html).toMatch(/<a [^>]*href="\/search"[^>]*>Wszystkie kolekcje<\/a>/);
    expect(mocks.getHomeAlbum).not.toHaveBeenCalled();
  });

  it("shows the fixed banner photo with the place as a link and the full credit", async () => {
    mocks.listRecent.mockResolvedValue([{ ...discover[0], cover: coverOf("ph1") }]);
    mocks.getBanner.mockResolvedValue(banner);
    const html = await render();

    expect(mocks.getBanner).toHaveBeenCalledWith("mosty-i-zamki", expect.anything());
    expect(html).toMatch(/<img [^>]*src="\/media\/p\/ph1\/main"[^>]*fetchPriority="high"/);
    expect(html).toMatch(/<a [^>]*href="\/places\/p9"[^>]*>Zamek w Płotach<\/a>/);
    expect(html).toContain("Autor:");
    expect(html).toContain("Jan Autor");
    expect(html).toContain("CC BY-SA 4.0");
    expect(html).toContain("<em>w swoim albumie</em>");
    // The search button is an outline button; the primary one is "Załóż konto" on the banner.
    expect(html).toMatch(/<button [^>]*class="button button--outline"[^>]*>Szukaj<\/button>/);
  });

  it("shows the photo drawn from the pool with its crop and credit, after connection()", async () => {
    mocks.getHomeBanner.mockResolvedValue({
      ...banner,
      photoId: "drawn",
      placeId: "p7",
      placeName: "Zamek w Krągu",
      focus: { wide: "50% 40%", narrow: "55% 50%" },
    });
    const html = await render();

    expect(mocks.connection).toHaveBeenCalled();
    expect(mocks.getBanner).not.toHaveBeenCalled();
    expect(html).toMatch(/<img [^>]*src="\/media\/p\/drawn\/main"/);
    expect(html).toContain("--focus-wide:50% 40%");
    expect(html).toContain("--focus-narrow:55% 50%");
    expect(html).toMatch(/<a [^>]*href="\/places\/p7"[^>]*>Zamek w Krągu<\/a>/);
  });

  it("falls back to the fixed photo when the pool gives nothing or its read fails", async () => {
    mocks.listRecent.mockResolvedValue([{ ...discover[0], cover: coverOf("ph1") }]);
    mocks.getBanner.mockResolvedValue(banner);

    for (const empty of [() => Promise.resolve(null), () => Promise.reject(new Error("db"))]) {
      mocks.getHomeBanner.mockImplementation(empty);
      const html = await render();

      expect(html).toMatch(/<img [^>]*src="\/media\/p\/ph1\/main"/);
      expect(html).not.toContain("--focus-wide");
    }

    expect(console.error).toHaveBeenCalledWith("Home banner pool read failed:", "Error");
  });

  it("keeps the introduction on a calm placeholder when no collection has a photo", async () => {
    const html = await render();

    expect(html).toMatch(/<h1[^>]*>Odkrywaj miejsca/);
    expect(html).toMatch(/<a [^>]*href="\/login"[^>]*>Zaloguj się<\/a>/);
    expect(mocks.getBanner).not.toHaveBeenCalled();
    expect(html).not.toContain("<img");
  });

  it("tells that there are no collections yet, and shows a message when the read fails", async () => {
    mocks.listRecent.mockResolvedValue([]);
    expect(await render()).toContain("Nie ma jeszcze opublikowanych kolekcji");

    mocks.listRecent.mockRejectedValue(new Error("db down: secret-host"));
    const html = await render();

    expect(html).toMatch(/role="alert"[^>]*>Nie udało się wczytać kolekcji\. Odśwież stronę\./);
    expect(html).toContain("Zaloguj się");
    expect(console.error).toHaveBeenCalledWith("Home collections read failed:", "Error");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("shows the guest version and logs only the error class when the session lookup fails", async () => {
    mocks.getActor.mockRejectedValue(new Error("auth down: secret-session-id"));

    const html = await render();

    expect(html).toContain("Zaloguj się");
    expect(console.error).toHaveBeenCalledWith("Session lookup failed:", "Error");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("confirms a sign-out and a failed sign-out in a status region", async () => {
    expect(await render({ wylogowano: "1" })).toMatch(/role="status"[^>]*>Wylogowano\./);
    expect(await render({ wylogowanie: "blad" })).toMatch(
      /role="status"[^>]*>Nie udało się wylogować\./,
    );
    // Nothing of the sign-out in the default page (the sorting status region is empty).
    const plain = await render();

    expect(plain.match(/role="status"/g)).toHaveLength(1);
    expect(plain).toMatch(/<p role="status"[^>]*><\/p>/);
    expect(plain).not.toContain("Wylogowano.");
    expect(plain).not.toContain("Nie udało się wylogować");
  });

  it("has one section of collections with the sorting button, and no separate W okolicy (K-34, D-49)", async () => {
    const html = await render();

    expect(html).not.toContain("W okolicy");
    expect(html.match(/<h2[^>]*>Kolekcje do odkrycia<\/h2>/g)).toHaveLength(1);
    // The button appears only once the component is ready in the browser (paczka S): the
    // server render has no button yet, only the empty status region.
    expect(html).not.toContain("Pokaż najbliższe");
    expect(html).not.toContain("Położenie zostaje w tej przeglądarce.");
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/);
    expect(html.match(/href="\/collections\/mosty-i-zamki"/g)).toHaveLength(1);
    // A wider layout on a computer (K-35) and a link with a class of its own (K-36).
    expect(html).toMatch(/class="content-width-wide /);
    expect(html).toMatch(
      /<a class="[^"]*sectionLink[^"]*" href="\/search">Wszystkie kolekcje<\/a>/,
    );
  });

  it("keeps the list, without the button, when the read of positions fails, and the rest works", async () => {
    mocks.listNearby.mockRejectedValue(new Error("db down: secret-host"));

    const html = await render();

    expect(html).not.toContain("Pokaż najbliższe");
    expect(html).toContain("Mosty i zamki");
    expect(console.error).toHaveBeenCalledWith("Home nearby read failed:", "Error");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("says an existing account was signed in, only for a signed-in person and the exact mark", async () => {
    mocks.getActor.mockResolvedValue({ id, role: "user" });
    mocks.getHomeAlbum.mockResolvedValue({ status: "forbidden" });
    mocks.listSaved.mockResolvedValue({ status: "forbidden" });

    expect(await render({ wejscie: "istnieje" })).toContain(
      "Masz już konto z tym adresem — zalogowaliśmy Cię.",
    );
    expect(await render({ wejscie: "logowanie" })).not.toContain("Masz już konto z tym adresem");

    // A guest sees nothing (the mark in a link must not tell anything about an address).
    mocks.getActor.mockResolvedValue(null);
    expect(await render({ wejscie: "istnieje" })).not.toContain("zalogowaliśmy Cię");
  });

  it("confirms a deleted account (E9-5) only for the exact signal", async () => {
    expect(await render({ konto: "usuniete" })).toMatch(
      /role="status"[^>]*>Twoje konto zostało usunięte\./,
    );
    // Only the empty status region of the sorting remains; no deletion message.
    const other = await render({ konto: "inne" });

    expect(other.match(/role="status"/g)).toHaveLength(1);
    expect(other).toMatch(/<p role="status"[^>]*><\/p>/);
    expect(other).not.toContain("Twoje konto zostało usunięte.");
  });
});

describe("home page of a signed-in explorer", () => {
  beforeEach(() => {
    mocks.getActor.mockResolvedValue({ id, role: "user" });
  });

  it("shows the summary, the favourites with X/Y progress, the visits and the collections to discover", async () => {
    const html = await render();

    expect(html).toMatch(/<h1[^>]*>Dzień dobry, <em>Anna<\/em><\/h1>/);
    // K-37: no announcement of what is below and no "Profil" button (the menu has it).
    expect(html).not.toContain("Oto Twój album");
    expect(html).not.toContain("Profil");
    expect(html).not.toContain("Zaloguj się");
    expect(html).toMatch(/<dt>Odkryte miejsca<\/dt><dd>7<\/dd>/);
    expect(html).toMatch(/<dt>Regiony<\/dt><dd>2<\/dd>/);
    expect(html).toMatch(/<dt>Zapisane kolekcje<\/dt><dd>1<\/dd>/);
    expect(html).toContain("Wieżyce");
    expect(html).toContain("1/4");
    expect(html).toMatch(/<a [^>]*href="\/my\/collections"[^>]*>Wszystkie moje kolekcje<\/a>/);
    expect(html).toContain("Wieża ciśnień");
    expect(html).toContain("marzec 2019");
    expect(html).toContain("z przeszłości");
    expect(html).toContain("Miejsce nie jest już dostępne");
    expect(html).toContain("potwierdzona na miejscu");
    expect(html).toContain("Mosty i zamki");
    // The phone shows the first four favourites; the rest only on a wide screen.
    expect(html.match(/phoneHidden/g)?.length ?? 0).toBe(2);
  });

  it("leaves a saved collection out of the collections to discover (W-07)", async () => {
    mocks.listRecent.mockResolvedValue([
      ...discover,
      { ...discover[0], id: "c9", slug: "inna", title: "Inna kolekcja" },
    ]);
    mocks.listSaved.mockResolvedValue({ status: "ok", value: ["mosty-i-zamki"] });

    const html = await render();

    expect(html).not.toContain('href="/collections/mosty-i-zamki"');
    expect(html).toContain('href="/collections/inna"');
  });

  it("asks for more collections than it shows and trims to twelve after the filter (W-07)", async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      ...discover[0],
      id: `m${i}`,
      slug: `m-${i}`,
      title: `Kolekcja ${i}`,
    }));

    mocks.listSaved.mockResolvedValue({ status: "ok", value: ["m-0", "m-1"] });
    mocks.listRecent.mockResolvedValue(many);

    const html = await render();

    // Two saved, so two more than twelve are read; twelve of the remaining ones are shown.
    expect(mocks.listRecent).toHaveBeenCalledWith(14, expect.anything());
    expect(html).not.toContain('href="/collections/m-0"');
    expect(html).not.toContain('href="/collections/m-1"');
    expect(html.match(/href="\/collections\/m-\d+"/g)).toHaveLength(12);
  });

  it("says so when every collection is saved, and keeps the whole list when the read fails (W-07)", async () => {
    mocks.listSaved.mockResolvedValue({ status: "ok", value: ["mosty-i-zamki"] });

    const html = await render();

    expect(html).toContain("Masz zapisane wszystkie kolekcje.");
    expect(html).not.toContain("Nie ma jeszcze opublikowanych kolekcji");

    mocks.listSaved.mockRejectedValue(new Error("db down: secret-saved"));

    const failed = await render();

    expect(failed).toContain('href="/collections/mosty-i-zamki"');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("greets without a name when the profile has none, or cannot be read (K-37)", async () => {
    mocks.getProfile.mockResolvedValue({ status: "ok", value: { firstName: null } });
    expect(await render()).toMatch(/<h1[^>]*>Dzień dobry<\/h1>/);

    mocks.getProfile.mockRejectedValue(new Error("db down: secret-profile"));
    expect(await render()).toMatch(/<h1[^>]*>Dzień dobry<\/h1>/);
    expect(console.error).toHaveBeenCalledWith("Home profile read failed:", "Error");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("shows the cover of the first saved collection as a banner with progress, then the album", async () => {
    mocks.getBanner.mockResolvedValue(banner);
    const html = await render();

    expect(mocks.getBanner).toHaveBeenCalledWith("wiezyce", expect.anything());
    // The whole banner is one link; the credit stays outside it (links do not nest).
    expect(html).toMatch(/<a [^>]*href="\/collections\/wiezyce"[^>]*><img [^>]*alt=""/);
    expect(html).toContain("Kolekcja · Łódzkie");
    expect(html).toContain("1/4 odwiedzone");
    expect(html).toMatch(/<\/a><p [^>]*>[^<]*<a [^>]*href="\/places\/p9"/);
    expect(html.indexOf("Moje kolekcje")).toBeLessThan(html.indexOf("Twój album"));
    expect(html.indexOf("Twój album")).toBeLessThan(html.indexOf("Kolekcje do odkrycia"));
  });

  it("keeps a calm placeholder banner when the saved collection has no photo", async () => {
    const html = await render();

    expect(html).toContain("Wieżyce");
    expect(html).toContain("1/4 odwiedzone");
    expect(html).not.toContain("<img");
  });

  it("shows the empty state on the banner photo for an explorer without a saved collection (Q6)", async () => {
    mocks.listRecent.mockResolvedValue([{ ...discover[0], cover: coverOf("ph1") }]);
    mocks.getBanner.mockResolvedValue(banner);
    mocks.getHomeAlbum.mockResolvedValue({
      status: "ok",
      value: {
        ...album,
        summary: { discoveredPlaces: 0, regions: 0, savedCollections: 1 },
        favorites: [],
        recentVisits: [],
      },
    });
    const html = await render();

    expect(html).toContain("Nie masz jeszcze zapisanych kolekcji");
    expect(html).toMatch(/<img [^>]*src="\/media\/p\/ph1\/main"/);
    expect(html).not.toContain("Odkrywaj miejsca");
  });

  it("gives an explorer with a visit but no saved collection a way forward under the sentence", async () => {
    mocks.getHomeAlbum.mockResolvedValue({
      status: "ok",
      value: {
        ...album,
        summary: { discoveredPlaces: 1, regions: 1, savedCollections: 0 },
        favorites: [],
      },
    });

    const html = await render();

    // A visit exists, so the page never says "you have nothing" (the golden path, scenario D).
    expect(html).not.toContain("Nie masz jeszcze zapisanych kolekcji");
    expect(html).toMatch(
      /Zapisz kolekcję, a pokażemy tu Twój postęp w niej\.<\/p><div[^>]*><a [^>]*href="#do-odkrycia"[^>]*>Zobacz kolekcje<\/a>/,
    );
    // The album block stays: there is a visit to show.
    expect(html).toContain("Twój album");
  });

  it("shows a new explorer (no visit, no saved collection) the big banner with the first step, not the zeros", async () => {
    mocks.getHomeBanner.mockResolvedValue({
      ...banner,
      focus: { wide: "50% 40%", narrow: "50% 40%" },
    });
    mocks.getHomeAlbum.mockResolvedValue({
      status: "ok",
      value: {
        summary: { discoveredPlaces: 0, regions: 0, savedCollections: 0 },
        favorites: [],
        recentVisits: [],
      },
    });

    const html = await render();

    expect(html).toMatch(/<h1[^>]*>Wybierz pierwszą kolekcję<\/h1>/);
    expect(html).toContain("Dzień dobry, Anna");
    expect(html).toContain(
      "Zapisz kolekcję, a pokażemy tu Twój postęp: ile miejsc odwiedzono i ile zostało.",
    );
    expect(html).toMatch(/<a [^>]*href="#do-odkrycia"[^>]*>Zobacz kolekcje<\/a>/);
    expect(html).toMatch(/<img [^>]*src="\/media\/p\/ph1\/main"/);
    expect(html).not.toContain("Twój album");
    expect(html).not.toContain("Odkryte miejsca");
    expect(html).not.toContain("Nie masz jeszcze zapisanych kolekcji");
    expect(html).not.toContain("Moje kolekcje");
    expect(html).not.toContain("Odkrywaj miejsca");
  });

  it("leaves the empty favourites with one sentence; the list of all collections is in the next heading row", async () => {
    mocks.getHomeAlbum.mockResolvedValue({
      status: "ok",
      value: {
        ...album,
        summary: { discoveredPlaces: 0, regions: 0, savedCollections: 1 },
        favorites: [],
        recentVisits: [],
      },
    });

    const html = await render();

    expect(html).toContain("Nie masz jeszcze zapisanych kolekcji");
    expect(html).not.toContain("Przeglądaj wszystkie kolekcje");
    expect(html).toMatch(/<a [^>]*href="\/search"[^>]*>Wszystkie kolekcje<\/a>/);
    expect(html).not.toContain("Wszystkie moje kolekcje");
    expect(html).toContain("Nie masz jeszcze wizyt");
  });

  it("leaves out the personal sections, and logs the class only, when the album read fails", async () => {
    mocks.getHomeAlbum.mockRejectedValue(new Error("db down: secret-user"));

    const html = await render();

    expect(html).not.toContain("Odkryte miejsca");
    expect(html).toContain("Mosty i zamki");
    expect(console.error).toHaveBeenCalledWith("Home album read failed:", "Error");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("leaves out the personal sections when the use case does not answer ok", async () => {
    mocks.getHomeAlbum.mockResolvedValue({ status: "unauthenticated" });

    expect(await render()).not.toContain("Odkryte miejsca");
  });
});
