import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  getHomeAlbum: vi.fn(),
  listRecent: vi.fn(),
  listNearby: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: mocks.getActor }),
}));
vi.mock("@/features/album/infrastructure/album-deps", () => ({ getAlbumDeps: () => ({}) }));
vi.mock("@/features/catalog/infrastructure/catalog-deps", () => ({ getCatalogDeps: () => ({}) }));
vi.mock("@/features/album/application/home-album", () => ({ getHomeAlbum: mocks.getHomeAlbum }));
vi.mock("@/features/catalog/application/public-catalog", () => ({
  listRecentlyPublishedCollections: mocks.listRecent,
  listNearbyCandidates: mocks.listNearby,
}));

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
  },
];

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
  mocks.getHomeAlbum.mockReset().mockResolvedValue({ status: "ok", value: album });
});

describe("home page of a guest", () => {
  it("shows the introduction, the login link and the collections to discover", async () => {
    const html = await render();

    expect(html).toMatch(/<h1[^>]*>Odkrywaj miejsca/);
    expect(html).toMatch(/<a [^>]*href="\/login"[^>]*>Zaloguj się<\/a>/);
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
    // Nothing of the sign-out in the default page (the "W okolicy" status region is empty).
    const plain = await render();

    expect(plain.match(/role="status"/g)).toHaveLength(1);
    expect(plain).toMatch(/<p role="status"><\/p>/);
    expect(plain).not.toContain("Wylogowano.");
    expect(plain).not.toContain("Nie udało się wylogować");
  });

  it("shows the section W okolicy with the button only, and no position or list before a click (E12-3)", async () => {
    const html = await render();

    expect(html).toMatch(/<h2[^>]*>W okolicy<\/h2>/);
    expect(html).toMatch(/<button [^>]*>Pokaż kolekcje w okolicy<\/button>/);
    expect(html).toMatch(/<p role="status"><\/p>/);
    // The only link to the collection is the one of "Kolekcje do odkrycia", not a nearby card.
    expect(html.match(/href="\/collections\/mosty-i-zamki"/g)).toHaveLength(1);
  });

  it("shows a message in the W okolicy section when its read fails, and the rest works", async () => {
    mocks.listNearby.mockRejectedValue(new Error("db down: secret-host"));

    const html = await render();

    expect(html).toMatch(/<h2[^>]*>W okolicy<\/h2>/);
    expect(html).not.toContain("Pokaż kolekcje w okolicy");
    expect(html).toContain("Mosty i zamki");
    expect(console.error).toHaveBeenCalledWith("Home nearby read failed:", "Error");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("confirms a deleted account (E9-5) only for the exact signal", async () => {
    expect(await render({ konto: "usuniete" })).toMatch(
      /role="status"[^>]*>Twoje konto zostało usunięte\./,
    );
    // Only the empty status region of "W okolicy" remains; no deletion message.
    const other = await render({ konto: "inne" });

    expect(other.match(/role="status"/g)).toHaveLength(1);
    expect(other).toMatch(/<p role="status"><\/p>/);
    expect(other).not.toContain("Twoje konto zostało usunięte.");
  });
});

describe("home page of a signed-in explorer", () => {
  beforeEach(() => {
    mocks.getActor.mockResolvedValue({ id, role: "user" });
  });

  it("shows the summary, the favourites with X/Y progress, the visits and the collections to discover", async () => {
    const html = await render();

    expect(html).toMatch(/<h1[^>]*>Dzień dobry<\/h1>/);
    expect(html).toMatch(/<a [^>]*href="\/my"[^>]*>Profil<\/a>/);
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

  it("points the empty favourites to the list of all collections", async () => {
    mocks.getHomeAlbum.mockResolvedValue({
      status: "ok",
      value: { ...album, favorites: [], recentVisits: [] },
    });

    const html = await render();

    expect(html).toContain("Nie masz jeszcze zapisanych kolekcji");
    expect(html).toMatch(/<a [^>]*href="\/search"[^>]*>Przeglądaj wszystkie kolekcje<\/a>/);
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
