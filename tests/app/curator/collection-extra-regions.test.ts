import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ detail: vi.fn() }));

vi.mock("@/features/catalog/application/curator-queries", () => ({
  getCuratorCollection: mocks.detail,
}));
vi.mock("@/features/catalog/infrastructure/catalog-deps", () => ({ getCatalogDeps: () => ({}) }));
vi.mock("@/app/curator/curator-session", () => ({
  requireCurator: async () => ({ actor: { id: "a" } }),
  pageValue: (outcome: { value: unknown }) => outcome.value,
}));
// The client parts of the editor have nothing to do with the line under test.
const nothing = () => null;

vi.mock("@/app/curator/collection-form", () => ({ CollectionForm: nothing }));
vi.mock("@/app/curator/collection-version", () => ({
  CollectionVersionProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/app/curator/cover-picker", () => ({ CoverPicker: nothing }));
vi.mock("@/app/curator/place-list", () => ({ PlaceList: nothing }));
vi.mock("@/app/curator/publication-controls", () => ({ PublicationControls: nothing }));

const page = await import("@/app/curator/collections/[collectionId]/page");

const detail = (extraRegions: readonly string[]) => ({
  status: "ok",
  value: {
    collection: {
      id: "c1",
      slug: "sudety",
      title: "Sudety",
      summary: "",
      region: "dolnoslaskie",
      extraRegions,
      status: "draft",
      firstPublishedAt: null,
      version: 1,
    },
    places: [],
    otherPlaces: [],
    coverPlacePhotoId: null,
    coverCandidates: [],
    autoCoverPhotoId: null,
  },
});

const render = async () =>
  renderToStaticMarkup(
    await page.default({
      params: Promise.resolve({ collectionId: "c1" }),
      searchParams: Promise.resolve({}),
    }),
  );

beforeEach(() => mocks.detail.mockReset());

describe("curator editor: extra voivodeships (read only)", () => {
  it("names them with a hint that the collection file sets them", async () => {
    mocks.detail.mockResolvedValue(detail(["opolskie", "slaskie"]));

    const html = await render();

    expect(html).toContain("Także w: Opolskie · Śląskie.");
    expect(html).toContain("Zmienisz to w pliku kolekcji.");
  });

  it("says nothing when the collection has none", async () => {
    mocks.detail.mockResolvedValue(detail([]));

    expect(await render()).not.toContain("Także w");
  });
});
