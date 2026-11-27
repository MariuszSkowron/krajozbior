import { describe, expect, it, vi } from "vitest";

import type { CatalogDeps, CollectionRow } from "@/features/catalog/application/catalog-types";
import { publishCollection } from "@/features/catalog/application/curator-collections";

// D-27 without a database: which address a publication asks for.
const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" as const };
const collectionId = "22222222-2222-4222-8222-222222222222";

const row = (overrides: Partial<CollectionRow>): CollectionRow => ({
  id: collectionId,
  slug: "robocza-nazwa-aaaaaa",
  organizationId: "org",
  title: "Zamki Pomorza",
  summary: "",
  region: "pomorskie",
  extraRegions: [],
  status: "draft",
  firstPublishedAt: null,
  version: 1,
  ...overrides,
});

function setup(current: CollectionRow, firstResults: (CollectionRow | null | "slug_taken")[] = []) {
  const publishFirstTime = vi.fn(async () =>
    firstResults.length > 0 ? (firstResults.shift() ?? null) : row({ status: "published" }),
  );
  const setCollectionStatus = vi.fn(async () => row({ status: "published", version: 3 }));
  let calls = 0;
  const deps = {
    withUserContext: (_who: unknown, work: (tx: unknown) => Promise<unknown>) => work({}),
    limiter: { reserve: async () => ({ allowed: true }) },
    // 'aaaaaa' first, then 'bbbbbb', and so on.
    random: () => Math.floor(calls++ / 6),
    repository: {
      permittedOrganizationIds: async () => ["org"],
      findEditableCollection: async () => current,
      listCollectionPlaceIds: async () => ["place"],
      publishFirstTime,
      setCollectionStatus,
    },
  } as unknown as CatalogDeps;

  return { deps, publishFirstTime, setCollectionStatus };
}

describe("publishCollection and the collection address (D-27)", () => {
  it("asks for an address made from the current title at the first publication", async () => {
    const { deps, publishFirstTime, setCollectionStatus } = setup(row({}));

    expect(await publishCollection(actor, collectionId, { version: 1 }, deps)).toMatchObject({
      status: "ok",
    });
    expect(publishFirstTime).toHaveBeenCalledWith({}, collectionId, 1, "zamki-pomorza-aaaaaa");
    expect(setCollectionStatus).not.toHaveBeenCalled();
  });

  it("keeps the address of a collection that was published before", async () => {
    const { deps, publishFirstTime, setCollectionStatus } = setup(
      row({ firstPublishedAt: new Date("2026-11-01T10:00:00Z") }),
    );

    expect(await publishCollection(actor, collectionId, { version: 1 }, deps)).toMatchObject({
      status: "ok",
    });
    expect(setCollectionStatus).toHaveBeenCalledWith({}, collectionId, 1, "published");
    expect(publishFirstTime).not.toHaveBeenCalled();
  });

  it("draws another suffix when the address is taken", async () => {
    const { deps, publishFirstTime } = setup(row({}), ["slug_taken"]);

    expect(await publishCollection(actor, collectionId, { version: 1 }, deps)).toMatchObject({
      status: "ok",
    });
    expect(publishFirstTime.mock.calls.map((call) => (call as unknown[])[3])).toEqual([
      "zamki-pomorza-aaaaaa",
      "zamki-pomorza-bbbbbb",
    ]);
  });

  it("gives up after repeated collisions", async () => {
    const { deps } = setup(row({}), Array(5).fill("slug_taken"));

    await expect(publishCollection(actor, collectionId, { version: 1 }, deps)).rejects.toThrow(
      /slug is taken/,
    );
  });

  it("answers a stale version when no row matches", async () => {
    const { deps } = setup(row({}), [null]);

    expect(await publishCollection(actor, collectionId, { version: 1 }, deps)).toEqual({
      status: "conflict",
      reason: "stale_version",
    });
  });
});
