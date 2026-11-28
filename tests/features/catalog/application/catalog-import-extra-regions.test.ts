import { describe, expect, it, vi } from "vitest";

import { executeCatalogImport } from "@/features/catalog/application/catalog-import";
import type { CatalogImportDeps } from "@/features/catalog/application/catalog-import-types";
import type { ImportCollection } from "@/features/catalog/domain/import-file";
import type { TransactionContext } from "@/lib/db/user-context";

const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" as const };
const organizationId = "22222222-2222-4222-8222-222222222222";
const collectionId = "33333333-3333-4333-8333-333333333333";
const tx = { em: {} } as unknown as TransactionContext;

const collection: ImportCollection = {
  line: 2,
  importKey: "col:jeden",
  title: "Jeden",
  summary: "Opis",
  region: "dolnoslaskie",
  extraRegions: ["opolskie"],
  kind: null,
  placeKeys: [],
  publish: false,
};
const file = {
  ok: true as const,
  batch: { batchId: "batch-1", sources: [] },
  collections: [collection],
  places: [],
  externalKeys: [],
};

// A published collection with the key of an earlier load: content and composition stay, so the
// only step left is the one for `extra_regions`.
const stored = {
  id: collectionId,
  organizationId,
  version: 3,
  status: "published",
  firstPublishedAt: new Date("2026-11-01T00:00:00Z"),
  title: "Jeden",
  summary: "Opis",
  region: "dolnoslaskie",
  extraRegions: [] as string[],
};

function setup(secondRead: typeof stored | null, setResult: boolean) {
  const findEditableCollection = vi
    .fn()
    .mockResolvedValueOnce(stored)
    .mockResolvedValue(secondRead);
  const setExtraRegions = vi.fn(async () => setResult);
  const updateKey = vi.fn(async () => undefined);
  const deps = {
    catalog: {
      withUserContext: async (_who: unknown, work: (t: TransactionContext) => unknown) => work(tx),
      repository: {
        permittedOrganizationIds: async () => [organizationId],
        findEditableCollection,
        listCollectionPlaceIds: async () => [],
        setExtraRegions,
      },
    },
    imports: {
      findOrganizationIdBySlug: async () => organizationId,
      lockImport: async () => undefined,
      readKeys: async () => [
        {
          kind: "collection",
          importKey: "col:jeden",
          entityId: collectionId,
          importedVersion: 3,
          importedPlaces: [],
        },
      ],
      updateKey,
      insertKey: vi.fn(),
    },
  } as unknown as CatalogImportDeps;

  return { deps, setExtraRegions };
}

const run = (deps: CatalogImportDeps) =>
  executeCatalogImport({ actor, orgSlug: "gmina-a", file, publish: false } as never, deps);

describe("import: the extra_regions step of a collection", () => {
  it("refuses with not_found when the collection is gone at that step", async () => {
    const { deps, setExtraRegions } = setup(null, true);
    const outcome = await run(deps);

    expect(outcome).toMatchObject({
      kind: "done",
      collections: [{ result: "refused", refusal: "not_found" }],
    });
    expect(setExtraRegions).not.toHaveBeenCalled();
  });

  it("refuses with not_found when the write touched no row, instead of reporting updated", async () => {
    const { deps, setExtraRegions } = setup(stored, false);
    const outcome = await run(deps);

    expect(setExtraRegions).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({
      kind: "done",
      collections: [{ result: "refused", refusal: "not_found" }],
    });
  });

  it("reports updated when the write succeeds", async () => {
    const { deps } = setup(stored, true);
    const outcome = await run(deps);

    expect(outcome).toMatchObject({ kind: "done", collections: [{ extraRegions: "updated" }] });
  });
});
