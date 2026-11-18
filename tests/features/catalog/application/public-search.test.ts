import { describe, expect, it, vi } from "vitest";

import type {
  CatalogDeps,
  RecentCollection,
  SearchPlaceHit,
} from "@/features/catalog/application/catalog-types";
import {
  listAllPublishedCollections,
  searchPublicCatalog,
} from "@/features/catalog/application/public-search";

const collection = (title: string): RecentCollection => ({
  id: title,
  slug: title.toLowerCase(),
  title,
  region: "pomorskie",
  organization: { name: "Gmina" },
  placeCount: 1,
});
const place = (name: string): SearchPlaceHit => ({
  id: name,
  name,
  address: "Tczew",
  collection: { slug: "k", title: "K" },
});

function depsWith(repository: Record<string, unknown>): CatalogDeps {
  return {
    withGuestContext: (work: (tx: unknown) => Promise<unknown>) => work({}),
    withUserContext: () => {
      throw new Error("the search must not use the user context");
    },
    repository: { isSearchTimeout: () => false, ...repository },
  } as unknown as CatalogDeps;
}

describe("searchPublicCatalog", () => {
  it("answers none without a phrase and invalid for a bad phrase, never touching the database", async () => {
    const deps = {
      ...depsWith({}),
      withGuestContext: () => {
        throw new Error("database reached");
      },
    } as unknown as CatalogDeps;

    expect(await searchPublicCatalog(" ", "pomorskie", deps)).toEqual({
      status: "none",
      region: "pomorskie",
    });
    expect(await searchPublicCatalog("a", "zly", deps)).toEqual({
      status: "invalid",
      reason: "too_short",
      region: null,
    });
    expect(await searchPublicCatalog("a".repeat(81), undefined, deps)).toEqual({
      status: "invalid",
      reason: "too_long",
      region: null,
    });
  });

  it("passes the patterns, the regions named like the phrase and the filter, and ranks the rows", async () => {
    const searchPublicCatalogRows = vi.fn(async () => ({
      collections: [collection("Z wieżą"), collection("Wieże")],
      places: [place("Wieża ciśnień")],
    }));
    const outcome = await searchPublicCatalog(
      "  Pomor ",
      "slaskie",
      depsWith({ searchPublicCatalog: searchPublicCatalogRows }),
    );

    expect(searchPublicCatalogRows).toHaveBeenCalledWith(
      {},
      { contains: "%pomor%", prefix: "pomor%", namedRegions: ["pomorskie"], region: "slaskie" },
      20,
    );
    expect(outcome).toMatchObject({
      status: "ok",
      phrase: "Pomor",
      region: "slaskie",
      moreCollections: false,
      morePlaces: false,
    });
  });

  it("flags more than 20 rows of a kind and shows only 20", async () => {
    const outcome = await searchPublicCatalog(
      "ab",
      undefined,
      depsWith({
        searchPublicCatalog: async () => ({
          collections: Array.from({ length: 21 }, (_, i) => collection(`ab ${i}`)),
          places: [],
        }),
      }),
    );

    expect(outcome).toMatchObject({ status: "ok", moreCollections: true, morePlaces: false });
    expect(outcome.status === "ok" && outcome.collections).toHaveLength(20);
  });

  it("answers timeout when the time limit cancelled the query and rethrows any other failure", async () => {
    const failure = new Error("cancelled");

    expect(
      await searchPublicCatalog(
        "ab",
        undefined,
        depsWith({
          searchPublicCatalog: async () => {
            throw failure;
          },
          isSearchTimeout: (error: unknown) => error === failure,
        }),
      ),
    ).toEqual({ status: "timeout" });
    await expect(
      searchPublicCatalog(
        "ab",
        undefined,
        depsWith({
          searchPublicCatalog: async () => {
            throw new Error("down");
          },
        }),
      ),
    ).rejects.toThrow("down");
  });
});

describe("listAllPublishedCollections", () => {
  it("reads at most 200 in the guest context and sorts by title in Polish order", async () => {
    const list = vi.fn(async () => [collection("Żary"), collection("Łódź"), collection("Lublin")]);
    const result = await listAllPublishedCollections(
      "pomorskie",
      depsWith({ listAllPublishedCollections: list }),
    );

    expect(list).toHaveBeenCalledWith({}, "pomorskie", 200);
    expect(result.region).toBe("pomorskie");
    expect(result.collections.map((c) => c.title)).toEqual(["Lublin", "Łódź", "Żary"]);
  });
});
