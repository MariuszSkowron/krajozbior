import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CatalogDeps,
  NewCollection,
  PlaceOfTheDay,
} from "@/features/catalog/application/catalog-types";
import {
  getHomePublicReads,
  resetPlaceOfDayCache,
} from "@/features/catalog/application/public-catalog";

const place: PlaceOfTheDay = {
  id: "p1",
  name: "Zamek",
  description: "Opis.",
  collection: { slug: "zamki", title: "Zamki" },
  photo: { photoId: "ph", width: 1000, height: 700, altText: "Zamek" },
};

const fresh = (slug: string) => ({ slug }) as unknown as NewCollection;

function depsWith(repository: Record<string, unknown>) {
  const withGuestContext = vi.fn(async (work: (tx: unknown) => unknown) => work({}));

  return {
    deps: { withGuestContext, repository } as unknown as CatalogDeps,
    withGuestContext,
  };
}

const empty = { listCollectionsPublishedSince: async () => [] };

beforeEach(() => {
  resetPlaceOfDayCache();
});

describe("getHomePublicReads: new collections", () => {
  it("reads in one guest transaction the collections of the last 30 days, at most three", async () => {
    const listCollectionsPublishedSince = vi.fn(async () => []);
    const { deps, withGuestContext } = depsWith({
      listCollectionsPublishedSince,
      countPlaceOfDayCandidates: async () => 0,
    });

    await getHomePublicReads(deps, new Set(), new Date("2026-11-24T10:00:00Z"));

    expect(withGuestContext).toHaveBeenCalledTimes(1);
    expect(listCollectionsPublishedSince).toHaveBeenCalledWith(
      expect.anything(),
      new Date("2026-10-25T10:00:00Z"),
      3,
    );
  });

  it("leaves out the excluded collections, reads that many more and keeps three", async () => {
    const listCollectionsPublishedSince = vi.fn(async () => [
      fresh("a"),
      fresh("b"),
      fresh("c"),
      fresh("d"),
      fresh("e"),
    ]);
    const { deps } = depsWith({
      listCollectionsPublishedSince,
      countPlaceOfDayCandidates: async () => 0,
    });
    const { newCollections } = await getHomePublicReads(deps, new Set(["a", "c"]));

    expect(listCollectionsPublishedSince).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Date),
      5,
    );
    expect(newCollections.map(({ slug }) => slug)).toEqual(["b", "d", "e"]);
  });
});

describe("getHomePublicReads: the place of the day", () => {
  it("gives nothing when no place qualifies and reads no place", async () => {
    const findPlaceOfDayAt = vi.fn();
    const { deps } = depsWith({
      ...empty,
      countPlaceOfDayCandidates: async () => 0,
      findPlaceOfDayAt,
    });

    expect((await getHomePublicReads(deps)).placeOfDay).toBeNull();
    expect(findPlaceOfDayAt).not.toHaveBeenCalled();
  });

  it("asks for the same candidate through the whole Polish day", async () => {
    const findPlaceOfDayAt = vi.fn(async () => place);
    const { deps } = depsWith({
      ...empty,
      countPlaceOfDayCandidates: async () => 9,
      findPlaceOfDayAt,
    });

    // 00:05 of 24 November in Poland (UTC+1), then the cache is dropped and 23:55 of the same day.
    expect(
      (await getHomePublicReads(deps, new Set(), new Date("2026-11-23T23:05:00Z"))).placeOfDay,
    ).toEqual(place);
    resetPlaceOfDayCache();
    expect(
      (await getHomePublicReads(deps, new Set(), new Date("2026-11-24T22:55:00Z"))).placeOfDay,
    ).toEqual(place);

    const [first, second] = findPlaceOfDayAt.mock.calls as unknown as [unknown, number][];

    expect(first[1]).toBe(second[1]);
    expect(first[1]).toBeGreaterThanOrEqual(0);
    expect(first[1]).toBeLessThan(9);
  });

  it("keeps the place in memory within its day and reads it again after 15 minutes", async () => {
    const findPlaceOfDayAt = vi.fn(async () => place);
    const countPlaceOfDayCandidates = vi.fn(async () => 9);
    const { deps } = depsWith({ ...empty, countPlaceOfDayCandidates, findPlaceOfDayAt });
    const start = new Date("2026-11-24T10:00:00Z");

    await getHomePublicReads(deps, new Set(), start);
    await getHomePublicReads(deps, new Set(), new Date(start.getTime() + 14 * 60 * 1000));

    expect(findPlaceOfDayAt).toHaveBeenCalledTimes(1);

    await getHomePublicReads(deps, new Set(), new Date(start.getTime() + 16 * 60 * 1000));

    expect(findPlaceOfDayAt).toHaveBeenCalledTimes(2);
  });

  it("does not keep the place when PLACE_OF_DAY_CACHE_TTL_MS is 0 (E2E servers)", async () => {
    const findPlaceOfDayAt = vi.fn(async () => place);
    const countPlaceOfDayCandidates = vi.fn(async () => 9);
    const { deps } = depsWith({ ...empty, countPlaceOfDayCandidates, findPlaceOfDayAt });
    const start = new Date("2026-11-24T10:00:00Z");

    vi.stubEnv("PLACE_OF_DAY_CACHE_TTL_MS", "0");
    try {
      await getHomePublicReads(deps, new Set(), start);
      await getHomePublicReads(deps, new Set(), new Date(start.getTime() + 1000));
    } finally {
      vi.unstubAllEnvs();
    }

    expect(findPlaceOfDayAt).toHaveBeenCalledTimes(2);
  });

  it("does not remember a failed read:the next read asks the source again", async () => {
    const findPlaceOfDayAt = vi
      .fn<() => Promise<PlaceOfTheDay | null>>()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(place);
    const { deps } = depsWith({
      ...empty,
      countPlaceOfDayCandidates: async () => 9,
      findPlaceOfDayAt,
    });
    const now = new Date("2026-11-24T10:00:00Z");

    await expect(getHomePublicReads(deps, new Set(), now)).rejects.toThrow("db down");
    expect((await getHomePublicReads(deps, new Set(), now)).placeOfDay).toEqual(place);
    expect(findPlaceOfDayAt).toHaveBeenCalledTimes(2);
  });

  it("does not remember an empty result: a place that appears is shown at the next read", async () => {
    const countPlaceOfDayCandidates = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(9);
    const findPlaceOfDayAt = vi.fn(async () => place);
    const { deps } = depsWith({ ...empty, countPlaceOfDayCandidates, findPlaceOfDayAt });
    const now = new Date("2026-11-24T10:00:00Z");

    expect((await getHomePublicReads(deps, new Set(), now)).placeOfDay).toBeNull();
    expect((await getHomePublicReads(deps, new Set(), now)).placeOfDay).toEqual(place);
  });

  it("reads the place again when the Polish day changes", async () => {
    const findPlaceOfDayAt = vi.fn(async () => place);
    const { deps } = depsWith({
      ...empty,
      countPlaceOfDayCandidates: async () => 9,
      findPlaceOfDayAt,
    });

    await getHomePublicReads(deps, new Set(), new Date("2026-11-24T22:50:00Z"));
    await getHomePublicReads(deps, new Set(), new Date("2026-11-24T23:05:00Z"));

    expect(findPlaceOfDayAt).toHaveBeenCalledTimes(2);
  });
});
