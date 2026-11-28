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
  extraRegions: [],
  organization: { name: "Gmina" },
  placeCount: 1,
  cover: null,
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

describe("searchPublicCatalog under load (m1)", () => {
  it("answers busy, not an error, when more than 4 searches wait too long for a place", async () => {
    vi.useFakeTimers();

    try {
      let release!: () => void;
      const hang = new Promise<void>((resolve) => {
        release = resolve;
      });
      const deps = depsWith({
        searchPublicCatalog: async () => {
          await hang;

          return { collections: [], places: [] };
        },
      });
      const running = Array.from({ length: 4 }, () => searchPublicCatalog("ab", undefined, deps));
      const fifth = searchPublicCatalog("ab", undefined, deps);

      await vi.advanceTimersByTimeAsync(2000);
      expect(await fifth).toEqual({ status: "busy" });

      release();
      const done = await Promise.all(running);

      expect(done.every((outcome) => outcome.status === "ok")).toBe(true);
      // places are free again
      expect((await searchPublicCatalog("ab", undefined, deps)).status).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("listAllPublishedCollections", () => {
  it("reads at most 200 in the guest context and sorts by title in Polish order", async () => {
    const list = vi.fn(async () => [collection("Żary"), collection("Łódź"), collection("Lublin")]);
    const result = await listAllPublishedCollections(
      "pomorskie",
      depsWith({ listAllPublishedCollections: list }),
    );

    // asks for one more than shown: the extra row only reveals the cut
    expect(list).toHaveBeenCalledWith({}, "pomorskie", 201);
    expect(result.region).toBe("pomorskie");
    expect(result.truncated).toBe(false);
    expect(result.collections.map((c) => c.title)).toEqual(["Lublin", "Łódź", "Żary"]);
  });

  it("cuts the list at 200 and says so when the repository returns the extra row", async () => {
    const rows = Array.from({ length: 201 }, (_, index) => collection(`K${index}`));
    const result = await listAllPublishedCollections(
      undefined,
      depsWith({ listAllPublishedCollections: async () => rows }),
    );

    expect(result.collections).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });
});
