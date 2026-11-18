import { describe, expect, it, vi } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { removePlaceFromCollection } from "@/features/catalog/application/curator-places";

// The rule "a published collection keeps at least one place" without a database.
const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" as const };
const collectionId = "22222222-2222-4222-8222-222222222222";
const placeA = "33333333-3333-4333-8333-333333333333";
const placeB = "44444444-4444-4444-8444-444444444444";

function setup(status: "draft" | "published", placeIds: string[]) {
  const unlinkPlace = vi.fn(async () => true);
  const deps = {
    withUserContext: (_who: unknown, work: (tx: unknown) => Promise<unknown>) => work({}),
    limiter: { reserve: async () => ({ allowed: true }) },
    repository: {
      permittedOrganizationIds: async () => ["org"],
      findEditableCollection: async () => ({ id: collectionId, status }),
      listCollectionPlaceIds: async () => placeIds,
      unlinkPlace,
    },
  } as unknown as CatalogDeps;

  return { deps, unlinkPlace };
}

describe("removePlaceFromCollection and published collections", () => {
  it("refuses to remove the last place of a published collection", async () => {
    const { deps, unlinkPlace } = setup("published", [placeA]);

    expect(await removePlaceFromCollection(actor, collectionId, placeA, deps)).toEqual({
      status: "conflict",
      reason: "last_place_of_published_collection",
    });
    expect(unlinkPlace).not.toHaveBeenCalled();
  });

  it("removes one of several places of a published collection", async () => {
    const { deps, unlinkPlace } = setup("published", [placeA, placeB]);

    expect(await removePlaceFromCollection(actor, collectionId, placeA, deps)).toEqual({
      status: "ok",
      value: null,
    });
    expect(unlinkPlace).toHaveBeenCalledTimes(1);
  });

  it("lets a draft lose its last place", async () => {
    const { deps } = setup("draft", [placeA]);

    expect(await removePlaceFromCollection(actor, collectionId, placeA, deps)).toEqual({
      status: "ok",
      value: null,
    });
  });

  it("does not block removing a place that is not the only one listed", async () => {
    const { deps } = setup("published", [placeA]);

    expect(await removePlaceFromCollection(actor, collectionId, placeB, deps)).toEqual({
      status: "ok",
      value: null,
    });
  });
});
