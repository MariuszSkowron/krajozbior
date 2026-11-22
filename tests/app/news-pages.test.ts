import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), item: vi.fn(), logFailure: vi.fn() }));

vi.mock("@/features/news/application/public-news", () => ({
  listPublicNews: mocks.list,
  getPublicNews: mocks.item,
}));
vi.mock("@/features/news/infrastructure/news-read-deps", () => ({ getNewsReadDeps: () => ({}) }));
vi.mock("@/app/request-actor", () => ({ logReadFailure: mocks.logFailure }));

const { CatalogError } = await import("@/app/catalog-error");
const listPage = await import("@/app/news/page");
const itemPage = await import("@/app/news/[slug]/page");
const errorBoundary = await import("@/app/news/error");
const { NewsBody } = await import("@/app/news/news-parts");
const { newsBodyParagraphs } = await import("@/features/news/domain/news-view");

const card = (overrides: Record<string, unknown> = {}) => ({
  slug: "jak-zbierac",
  kind: "guide",
  title: "Jak zbierać <miejsca>",
  lead: "Krótki tekst.",
  publishedAt: new Date("2026-11-20T10:00:00Z"),
  eventStartsOn: null,
  eventEndsOn: null,
  organization: { name: "Krajozbiór — redakcja", slug: "krajozbior-redakcja" },
  verification: "editorial",
  ...overrides,
});

const full = (overrides: Record<string, unknown> = {}) => ({
  ...card(),
  body: "Pierwszy akapit.\n\nZobacz https://example.org/a.",
  contentUpdatedAt: null,
  collection: null,
  place: null,
  ...overrides,
});

const render = async (page: () => Promise<unknown>) =>
  renderToStaticMarkup((await page()) as Parameters<typeof renderToStaticMarkup>[0]);

const list = (query: Record<string, string | string[]> = {}) =>
  render(() => listPage.default({ searchParams: Promise.resolve(query) }));

// Each case uses its own address: the item page reads through React's per-request cache.
let counter = 0;
const next = () => `adres-${(counter += 1)}`;
const item = (slug = next()) =>
  render(() => itemPage.default({ params: Promise.resolve({ slug }) }));

beforeEach(() => {
  mocks.list.mockReset();
  mocks.item.mockReset();
  mocks.logFailure.mockReset();
});

describe("news list page", () => {
  it("is rendered on every request and has its own title", () => {
    expect(listPage.dynamic).toBe("force-dynamic");
    expect(listPage.metadata).toMatchObject({ title: "Aktualności — Krajozbiór" });
  });

  it("shows the subtitle of the editorial version, the filters and the count", async () => {
    mocks.list.mockResolvedValue([card(), card({ slug: "drugi", title: "Drugi" })]);

    const html = await list();

    expect(html).toContain("<h1>Aktualności</h1>");
    expect(html).toContain("Nowości od Krajozbioru i organizacji, które prowadzą kolekcje.");
    expect(html).toContain('aria-label="Filtr aktualności"');
    expect(html).toMatch(/aria-current="true" href="\/news">Wszystkie</);
    expect(html).toContain('href="/news?filtr=wydarzenia">Wydarzenia</a>');
    expect(html).toMatch(/<p class="[^"]+">2 aktualności</);
    expect(mocks.list).toHaveBeenCalledWith(null, {});
  });

  it("makes the first card featured and gives each card one link, the title, to its page", async () => {
    mocks.list.mockResolvedValue([card(), card({ slug: "drugi", title: "Drugi" })]);

    const html = await list();
    const cards = html.match(/<article[\s\S]*?<\/article>/g) ?? [];

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatch(/class="[^"]*featured/);
    expect(cards[1]).not.toMatch(/featured/);
    for (const one of cards) {
      expect(one.match(/<a /g)).toHaveLength(1);
    }
    expect(cards[0]).toContain('href="/news/jak-zbierac">Jak zbierać &lt;miejsca&gt;</a>');
    expect(cards[0]).toContain('<time dateTime="2026-11-20">20.11.2026</time>');
    expect(cards[0]).toContain("Poradnik");
    expect(cards[0]).toContain("Krajozbiór — redakcja");
    expect(cards[0]).toContain("Zespół Krajozbioru");
    expect(html).not.toContain("Zgłoś treść");
  });

  it("marks an organization approved by the team as verified", async () => {
    mocks.list.mockResolvedValue([
      card({
        organization: { name: "Gmina Tczew", slug: "gmina-tczew" },
        verification: "verified",
      }),
    ]);

    const html = await list();

    expect(html).toContain("Gmina Tczew");
    expect(html).toContain("Zweryfikowana organizacja");
    expect(html).toContain(">G</span>");
  });

  it("shows the days of an event", async () => {
    mocks.list.mockResolvedValue([
      card({ kind: "event", eventStartsOn: "2027-04-17", eventEndsOn: "2027-04-18" }),
    ]);

    const html = await list({ filtr: "wydarzenia" });

    expect(html).toContain("Wydarzenie");
    expect(html).toContain('Termin: <time dateTime="2027-04-17">17–18.04.2027</time>');
    expect(mocks.list).toHaveBeenCalledWith("events", expect.anything());
    expect(html).toMatch(/aria-current="true" href="\/news\?filtr=wydarzenia">Wydarzenia</);
    expect(html).toContain("1 wydarzenie");
    // The filtered list has no featured card.
    expect(html).not.toMatch(/class="[^"]*featured/);
  });

  it("keeps the publication date out of the kicker of an event and labels it 'Dodano'", async () => {
    mocks.list.mockResolvedValue([
      card({
        kind: "event",
        publishedAt: new Date("2026-11-22T10:00:00Z"),
        eventStartsOn: "2027-04-17",
        eventEndsOn: "2027-04-18",
      }),
    ]);

    const html = await list({ filtr: "wydarzenia" });
    const kicker = html.match(/<p class="[^"]*kicker[^"]*">[\s\S]*?<\/p>/)?.[0] ?? "";

    expect(kicker).toContain("Wydarzenie");
    expect(kicker).not.toContain("<time");
    expect(kicker).not.toContain("22.11.2026");
    expect(html).toContain('Dodano <time dateTime="2026-11-22">22.11.2026</time>');
    expect(html).toContain('Termin: <time dateTime="2027-04-17">17–18.04.2027</time>');
  });

  it("says that nothing is published yet, without a link to everything", async () => {
    mocks.list.mockResolvedValue([]);

    const html = await list();

    expect(html).toContain("Zespół Krajozbioru nie opublikował jeszcze aktualności.");
    expect(html).toContain("0 aktualności");
    expect(html).not.toContain("Pokaż wszystkie aktualności");
  });

  it("says that no event is coming and offers all items for the filter", async () => {
    mocks.list.mockResolvedValue([]);

    const html = await list({ filtr: "wydarzenia" });

    expect(html).toContain("Nie ma teraz zapowiedzi wydarzeń.");
    expect(html).toContain('href="/news">Pokaż wszystkie aktualności</a>');
  });

  it("counts a single item in the singular", async () => {
    mocks.list.mockResolvedValue([card()]);

    expect(await list()).toContain("1 aktualność");
  });

  it("logs only the class of a failure and throws a generic error for the error screen (S5)", async () => {
    mocks.list.mockRejectedValue(new Error("select * from news_posts where secret"));

    await expect(list()).rejects.toThrow("Public news list failed");
    expect(mocks.logFailure).toHaveBeenCalledWith("Public news list", expect.any(Error));
  });
});

describe("news item page", () => {
  it("is rendered on every request", () => {
    expect(itemPage.dynamic).toBe("force-dynamic");
  });

  it("shows the article: title, lead, organization, date, paragraphs and a safe link", async () => {
    mocks.item.mockResolvedValue({ status: "ok", value: full() });

    const html = await item();

    expect(html).toContain("<article");
    expect(html).toContain("<h1>Jak zbierać &lt;miejsca&gt;</h1>");
    expect(html).toContain("Krótki tekst.");
    expect(html).toContain("Krajozbiór — redakcja");
    expect(html).toContain('Dodano <time dateTime="2026-11-20">20.11.2026</time>');
    expect(html.match(/<p class="[^"]*kicker[^"]*">[\s\S]*?<\/p>/)?.[0]).not.toContain("<time");
    expect(html).toContain("<p><span>Pierwszy akapit.</span></p>");
    expect(html).toMatch(
      /<a href="https:\/\/example\.org\/a" rel="nofollow ugc noopener noreferrer">https:\/\/example\.org\/a<\/a>/,
    );
    expect(html).toContain('href="/news">← Wszystkie aktualności</a>');
    expect(html).not.toContain("Zgłoś treść");
    expect(html).not.toContain("Powiązane");
    expect(html).not.toContain("Zaktualizowano");
  });

  it("shows markup in the text as text and makes no link of it", async () => {
    mocks.item.mockResolvedValue({
      status: "ok",
      value: full({
        title: "Test",
        body: '<script>alert(1)</script> <img src=x onerror="alert(2)">\n\njavascript:alert(3) http://example.com',
      }),
    });

    const html = await item();

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('href="http:');
  });

  it("shows the note about an update only when the content changed later than the limit", async () => {
    mocks.item.mockResolvedValue({
      status: "ok",
      value: full({ contentUpdatedAt: new Date("2026-11-21T09:00:00Z") }),
    });

    expect(await item()).toContain('Zaktualizowano <time dateTime="2026-11-21">21.11.2026</time>');

    mocks.item.mockResolvedValue({
      status: "ok",
      value: full({ contentUpdatedAt: new Date("2026-11-20T10:05:00Z") }),
    });

    expect(await item()).not.toContain("Zaktualizowano");
  });

  it("links the public collection and place", async () => {
    mocks.item.mockResolvedValue({
      status: "ok",
      value: full({
        collection: { slug: "mosty-a1b2c3", title: "Mosty" },
        place: { id: "22222222-2222-4222-8222-222222222222", name: "Most Tczewski" },
      }),
    });

    const html = await item();

    expect(html).toContain('href="/collections/mosty-a1b2c3">Mosty</a>');
    expect(html).toContain('href="/places/22222222-2222-4222-8222-222222222222">Most Tczewski</a>');
  });

  it("links only the place or only the collection when the other is missing", async () => {
    mocks.item.mockResolvedValue({
      status: "ok",
      value: full({ collection: { slug: "mosty-a1b2c3", title: "Mosty" } }),
    });

    const onlyCollection = await item();

    expect(onlyCollection).toContain("Kolekcja:");
    expect(onlyCollection).not.toContain("Miejsce:");

    mocks.item.mockResolvedValue({
      status: "ok",
      value: full({ place: { id: "22222222-2222-4222-8222-222222222222", name: "Most" } }),
    });

    const onlyPlace = await item();

    expect(onlyPlace).toContain("Miejsce:");
    expect(onlyPlace).not.toContain("Kolekcja:");
  });

  it("answers 404 for an item that is not public", async () => {
    mocks.item.mockResolvedValue({ status: "not_found" });

    await expect(item()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404"),
    });
  });

  it("logs only the class of a failure and throws a generic error for the error screen (S5)", async () => {
    mocks.item.mockRejectedValue(new Error("select * from news_posts where secret"));

    await expect(item()).rejects.toThrow("Public news read failed");
    expect(mocks.logFailure).toHaveBeenCalledWith("Public news read", expect.any(Error));
  });

  it("builds the metadata of an article from the title and the lead, without a canonical address", async () => {
    mocks.item.mockResolvedValue({ status: "ok", value: full({ title: "Jak zbierać" }) });

    const metadata = await itemPage.generateMetadata({ params: Promise.resolve({ slug: next() }) });

    expect(metadata).toMatchObject({
      title: "Jak zbierać — Krajozbiór",
      description: "Krótki tekst.",
      openGraph: {
        type: "article",
        title: "Jak zbierać",
        description: "Krótki tekst.",
        locale: "pl_PL",
        publishedTime: "2026-11-20T10:00:00.000Z",
      },
    });
    expect(metadata.alternates).toBeUndefined();
  });

  it("gives default metadata, not an error, when the item is missing or the read fails", async () => {
    mocks.item.mockResolvedValue({ status: "not_found" });
    expect(await itemPage.generateMetadata({ params: Promise.resolve({ slug: next() }) })).toEqual(
      {},
    );

    mocks.item.mockRejectedValue(new Error("db down"));
    expect(await itemPage.generateMetadata({ params: Promise.resolve({ slug: next() }) })).toEqual(
      {},
    );
  });
});

describe("news body and error boundary", () => {
  it("writes a link of non-ASCII letters in the safe form with what the author wrote", () => {
    const html = renderToStaticMarkup(
      createElement(NewsBody, { paragraphs: newsBodyParagraphs("Zobacz https://żółć.pl/a") }),
    );

    expect(html).toContain("xn--");
    expect(html).toContain("(autor wpisał: https://żółć.pl/a)");
  });

  it("uses the catalog error screen for the whole segment", () => {
    const html = renderToStaticMarkup(
      createElement(errorBoundary.default, { error: new Error("x"), retry: () => undefined }),
    );

    expect(html).toBe(
      renderToStaticMarkup(createElement(CatalogError, { retry: () => undefined })),
    );
    expect(html).toContain("Nie udało się wczytać strony");
  });
});
