import { describe, expect, it, vi } from "vitest";

import type {
  CatalogDeps,
  HomeBannerCandidate,
} from "@/features/catalog/application/catalog-types";
import { getHomeBanner } from "@/features/catalog/application/public-catalog";

const photo = (qid: string, placeId: string): HomeBannerCandidate => ({
  qid,
  photoId: `ph-${placeId}`,
  width: 1600,
  height: 1000,
  altText: "Zamek",
  title: null,
  authorText: "Autor",
  authorUrl: null,
  sourceUrl: null,
  sourceKind: "commons_import",
  licenseCode: "cc-by-sa-4.0",
  licenseUrl: null,
  licenseLabel: "CC BY-SA 4.0",
  placeId,
  placeName: `Miejsce ${placeId}`,
});

const pool = [
  { qid: "Q1", focus: { wide: "10% 10%", narrow: "20% 20%" } },
  { qid: "Q2", focus: { wide: "30% 30%", narrow: "40% 40%" } },
];

function depsWith(find: (qids: readonly string[]) => Promise<readonly HomeBannerCandidate[]>) {
  const findHomeBannerCandidates = vi.fn(async (_tx: unknown, qids: readonly string[]) =>
    find(qids),
  );
  const withGuestContext = vi.fn(async (work: (tx: unknown) => unknown) => work({}));

  return {
    deps: {
      withGuestContext,
      repository: { findHomeBannerCandidates },
    } as unknown as CatalogDeps,
    findHomeBannerCandidates,
    withGuestContext,
  };
}

describe("getHomeBanner", () => {
  it("reads the pool in the guest context and returns the drawn place with its crop", async () => {
    const { deps, findHomeBannerCandidates, withGuestContext } = depsWith(async () => [
      photo("Q1", "p1"),
      photo("Q2", "p2"),
    ]);

    const first = await getHomeBanner(deps, () => 0, pool);
    const second = await getHomeBanner(deps, () => 0.9, pool);

    expect(withGuestContext).toHaveBeenCalledTimes(2);
    expect(findHomeBannerCandidates).toHaveBeenCalledWith(expect.anything(), ["Q1", "Q2"]);
    expect(first).toMatchObject({ placeId: "p1", focus: pool[0]!.focus });
    expect(second).toMatchObject({ placeId: "p2", focus: pool[1]!.focus });
    expect(first).not.toHaveProperty("qid");
  });

  it("falls back to null when no place of the pool has a photo", async () => {
    const { deps } = depsWith(async () => []);

    expect(await getHomeBanner(deps, () => 0, pool)).toBeNull();
  });

  it("ignores a candidate that is not in the pool", async () => {
    const { deps } = depsWith(async () => [photo("Q99", "px")]);

    expect(await getHomeBanner(deps, () => 0, pool)).toBeNull();
  });

  it("uses the pool of the code by default", async () => {
    const { deps, findHomeBannerCandidates } = depsWith(async () => []);

    await getHomeBanner(deps);

    expect(findHomeBannerCandidates.mock.calls[0]![1]).toContain("Q442169");
  });

  it("passes a failed read on to the caller (the page logs it and keeps the fixed photo)", async () => {
    const { deps } = depsWith(async () => {
      throw new Error("db down");
    });

    await expect(getHomeBanner(deps, () => 0, pool)).rejects.toThrow("db down");
  });
});
