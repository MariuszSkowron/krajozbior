import { describe, expect, it, vi } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { createCollection } from "@/features/catalog/application/curator-collections";
import { MAX_COLLECTIONS_PER_LIST } from "@/features/catalog/domain/limits";

// The limit of collections of one organization, kept when writing (D-28).
const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" as const };
const input = { organizationId: "org", title: "Nowa kolekcja", region: "pomorskie" };

function setup(existing: number) {
  const insertCollection = vi.fn(async () => ({ id: "c1" }));
  const countOrganizationCollections = vi.fn(async () => existing);
  const deps = {
    withUserContext: (_who: unknown, work: (tx: unknown) => Promise<unknown>) => work({}),
    limiter: { reserve: async () => ({ allowed: true }) },
    random: () => 0,
    repository: {
      permittedOrganizationIds: async () => ["org"],
      countOrganizationCollections,
      insertCollection,
    },
  } as unknown as CatalogDeps;

  return { deps, insertCollection, countOrganizationCollections };
}

describe("createCollection and the limit of collections of an organization", () => {
  it("refuses the 201st collection without inserting anything", async () => {
    const { deps, insertCollection, countOrganizationCollections } =
      setup(MAX_COLLECTIONS_PER_LIST);

    expect(await createCollection(actor, input, deps)).toEqual({
      status: "conflict",
      reason: "too_many_collections",
    });
    expect(countOrganizationCollections).toHaveBeenCalledWith(expect.anything(), "org");
    expect(insertCollection).not.toHaveBeenCalled();
  });

  it("creates the last allowed collection", async () => {
    const { deps, insertCollection } = setup(MAX_COLLECTIONS_PER_LIST - 1);

    expect((await createCollection(actor, input, deps)).status).toBe("ok");
    expect(insertCollection).toHaveBeenCalledTimes(1);
  });
});
