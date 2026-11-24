import { describe, expect, it, vi } from "vitest";

import type { CatalogDeps, PlaceOfTheDay } from "@/features/catalog/application/catalog-types";
import {
  getPlaceOfTheDay,
  listNewCollections,
} from "@/features/catalog/application/public-catalog";

const place: PlaceOfTheDay = {
  id: "p1",
  name: "Zamek",
  description: "Opis.",
  collection: { slug: "zamki", title: "Zamki" },
  photo: { photoId: "ph", width: 1000, height: 700, altText: "Zamek" },
};

function depsWith(repository: Record<string, unknown>) {
  const withGuestContext = vi.fn(async (work: (tx: unknown) => unknown) => work({}));

  return {
    deps: { withGuestContext, repository } as unknown as CatalogDeps,
    withGuestContext,
  };
}

describe("listNewCollections", () => {
  it("reads in the guest context the collections of the last 30 days, at most three", async () => {
    const listCollectionsPublishedSince = vi.fn(async () => []);
    const { deps, withGuestContext } = depsWith({ listCollectionsPublishedSince });

    await listNewCollections(deps, new Date("2026-11-24T10:00:00Z"));

    expect(withGuestContext).toHaveBeenCalledTimes(1);
    expect(listCollectionsPublishedSince).toHaveBeenCalledWith(
      expect.anything(),
      new Date("2026-10-25T10:00:00Z"),
      3,
    );
  });
});

describe("getPlaceOfTheDay", () => {
  it("gives nothing when no place qualifies and reads no place", async () => {
    const findPlaceOfDayAt = vi.fn();
    const { deps } = depsWith({ countPlaceOfDayCandidates: async () => 0, findPlaceOfDayAt });

    expect(await getPlaceOfTheDay(deps)).toBeNull();
    expect(findPlaceOfDayAt).not.toHaveBeenCalled();
  });

  it("asks for the same candidate through the whole Polish day", async () => {
    const findPlaceOfDayAt = vi.fn(async () => place);
    const { deps } = depsWith({ countPlaceOfDayCandidates: async () => 9, findPlaceOfDayAt });

    // 00:05 and 23:55 of 24 November in Poland (UTC+1).
    expect(await getPlaceOfTheDay(deps, new Date("2026-11-23T23:05:00Z"))).toEqual(place);
    expect(await getPlaceOfTheDay(deps, new Date("2026-11-24T22:55:00Z"))).toEqual(place);

    const [first, second] = findPlaceOfDayAt.mock.calls as unknown as [unknown, number][];

    expect(first[1]).toBe(second[1]);
    expect(first[1]).toBeGreaterThanOrEqual(0);
    expect(first[1]).toBeLessThan(9);
  });
});
