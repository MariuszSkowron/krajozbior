import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ collection: vi.fn(), place: vi.fn() }));

vi.mock("@/features/catalog/application/public-catalog", () => ({
  getPublishedCollection: mocks.collection,
  getPublishedPlace: mocks.place,
}));
vi.mock("@/features/catalog/infrastructure/catalog-deps", () => ({ getCatalogDeps: () => ({}) }));
vi.mock("@/app/request-actor", () => ({ logReadFailure: vi.fn() }));

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
  places: [{ id: placeId, name: "Most", address: "Tczew", position: 1 }],
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
};

// Each case uses its own address: the pages read through React's per-request cache.
let counter = 0;
const next = () => `adres-${(counter += 1)}`;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.collection.mockReset();
  mocks.place.mockReset();
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
    expect(html).toContain("Pomorskie · Prowadzi: Gmina A");
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

  it("say so when a collection has no places yet", async () => {
    mocks.collection.mockResolvedValue({ status: "ok", value: { ...collection, places: [] } });

    const html = renderToStaticMarkup(
      await collectionPage.default({ params: Promise.resolve({ slug: next() }) }),
    );

    expect(html).toContain("Ta kolekcja nie ma jeszcze miejsc.");
    expect(html).not.toContain("(0)");
    expect(html).not.toContain("<ol");
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
});
