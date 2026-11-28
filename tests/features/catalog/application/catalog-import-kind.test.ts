import { describe, expect, it, vi } from "vitest";

import { executeCatalogImport } from "@/features/catalog/application/catalog-import";
import type { CatalogImportDeps } from "@/features/catalog/application/catalog-import-types";
import type { ImportCollection } from "@/features/catalog/domain/import-file";
import type { TransactionContext } from "@/lib/db/user-context";

const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" as const };
const organizationId = "22222222-2222-4222-8222-222222222222";
const collectionId = "33333333-3333-4333-8333-333333333333";
const tx = { em: {} } as unknown as TransactionContext;

const collection = (kind: ImportCollection["kind"]): ImportCollection => ({
  line: 2,
  importKey: "col:jeden",
  title: "Jeden",
  summary: "Opis",
  region: "dolnoslaskie",
  extraRegions: null,
  kind,
  placeKeys: [],
  publish: false,
});
const fileWith = (kind: ImportCollection["kind"]) => ({
  ok: true as const,
  batch: { batchId: "batch-1", sources: [] },
  collections: [collection(kind)],
  places: [],
  externalKeys: [],
});

// A published collection with the key of an earlier load: content and composition stay, so the
// only step left is the one for `kind`.
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
  kind: "theme",
};

function setup(secondRead: typeof stored | null, setResult: boolean) {
  const findEditableCollection = vi
    .fn()
    .mockResolvedValueOnce(stored)
    .mockResolvedValue(secondRead);
  const setKind = vi.fn(async () => setResult);
  const setExtraRegions = vi.fn(async () => true);
  const deps = {
    catalog: {
      withUserContext: async (_who: unknown, work: (t: TransactionContext) => unknown) => work(tx),
      repository: {
        permittedOrganizationIds: async () => [organizationId],
        findEditableCollection,
        listCollectionPlaceIds: async () => [],
        setKind,
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
      updateKey: vi.fn(async () => undefined),
      insertKey: vi.fn(),
    },
  } as unknown as CatalogImportDeps;

  return { deps, setKind, setExtraRegions };
}

const run = (deps: CatalogImportDeps, kind: ImportCollection["kind"]) =>
  executeCatalogImport(
    { actor, orgSlug: "gmina-a", file: fileWith(kind), publish: false } as never,
    deps,
  );

describe("import: the kind step of a collection", () => {
  it("does nothing and reports nothing when the file does not name kind", async () => {
    const { deps, setKind } = setup(stored, true);
    const outcome = await run(deps, null);

    expect(setKind).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: "done" });
    expect(JSON.stringify(outcome)).not.toContain('"kind":"updated"');
    expect(JSON.stringify(outcome)).not.toContain('"kind":"unchanged"');
  });

  it("reports unchanged and writes nothing when the kind is already as in the file", async () => {
    const { deps, setKind } = setup(stored, true);
    const outcome = await run(deps, "theme");

    expect(setKind).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: "done", collections: [{ kind: "unchanged" }] });
  });

  it("sets the kind of a published collection and reports updated", async () => {
    const { deps, setKind } = setup(stored, true);
    const outcome = await run(deps, "land");

    expect(setKind).toHaveBeenCalledWith(tx, collectionId, "land");
    expect(outcome).toMatchObject({ kind: "done", collections: [{ kind: "updated" }] });
  });

  it("refuses with not_found when the collection is gone at that step", async () => {
    const { deps, setKind } = setup(null, true);
    const outcome = await run(deps, "land");

    expect(setKind).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      kind: "done",
      collections: [{ result: "refused", refusal: "not_found" }],
    });
  });

  it("refuses with not_found when the write touched no row, instead of reporting updated", async () => {
    const { deps } = setup(stored, false);
    const outcome = await run(deps, "land");

    expect(outcome).toMatchObject({
      kind: "done",
      collections: [{ result: "refused", refusal: "not_found" }],
    });
  });
});
