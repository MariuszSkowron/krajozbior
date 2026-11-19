import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import {
  decideCollection,
  decidePlace,
  diffComposition,
  sameIds,
  type ImportKeyState,
  type StoredCollection,
  type StoredPlace,
} from "../domain/import-diff";
import type { ImportCollection, ImportFileResult, ImportPlace } from "../domain/import-file";
import { MAX_COLLECTIONS_PER_LIST } from "../domain/limits";
import type {
  CatalogImportDeps,
  CatalogImportOutcome,
  CollectionReport,
  CollectionResult,
  CompositionResult,
  ImportKeyRow,
  ImportPreview,
  PlaceReport,
  PlaceResult,
} from "./catalog-import-types";
import type { CatalogDeps, CuratorOutcome } from "./catalog-types";
import { addPlace, removePlaceFromCollection, reorderPlaces, updatePlace } from "./curator-places";
import { createCollection, updateCollection } from "./curator-collections";

// Loading a validated file into the database of one organization, as a curator
// and through the ordinary curator use cases (so the row policies and the
// domain rules apply). One transaction per collection; its first statement is
// the lock of the loader. Idempotent: a second load of the same file changes
// nothing, and what a curator edited in the panel is kept (`kept_manual_*`).

export type ValidImportFile = Extract<ImportFileResult, { ok: true }>;

export type CatalogImportRequest = Readonly<{
  actor: Actor;
  orgSlug: string;
  file: ValidImportFile;
  /** Only reads and reports what a load would do (information, not a plan). */
  preview: boolean;
}>;

// Raised when a use case was handed another actor than the one the
// transaction belongs to (issue #42: one actor per transaction).
export class ActorMismatchError extends Error {
  constructor() {
    super("Bound dependencies were used for another actor");
    this.name = "ActorMismatchError";
  }
}

/**
 * The curator use cases open their own transaction through
 * `deps.withUserContext`, and a nested one is refused. The loader opens one
 * transaction per collection and hands the use cases dependencies bound to it:
 * `withUserContext` runs the work on the open transaction, only for the actor
 * it belongs to. The guest context is not available. Meant for the loader only.
 */
export function bindDepsToTransaction(
  tx: TransactionContext,
  actor: Pick<Actor, "id">,
  deps: CatalogDeps,
): CatalogDeps {
  return {
    ...deps,
    withUserContext: async (who, work) => {
      if (who.id !== actor.id) {
        throw new ActorMismatchError();
      }

      return work(tx);
    },
    withGuestContext: async () => {
      throw new Error("The guest context is not available inside the loader");
    },
  };
}

// A use case refused in the middle of a collection: the collection is rolled back.
class CollectionRefusal extends Error {
  constructor(readonly reason: string) {
    super("Collection load refused");
    this.name = "CollectionRefusal";
  }
}

function must<T>(outcome: CuratorOutcome<T>): T {
  if (outcome.status === "ok") {
    return outcome.value;
  }

  const reason = "reason" in outcome ? `${outcome.status}:${outcome.reason}` : outcome.status;

  throw new CollectionRefusal(reason);
}

type KeyMaps = Readonly<{
  collections: Map<string, ImportKeyRow>;
  places: Map<string, ImportKeyRow>;
}>;

function indexKeys(rows: readonly ImportKeyRow[]): KeyMaps {
  const maps: KeyMaps = { collections: new Map(), places: new Map() };

  for (const row of rows) {
    (row.kind === "collection" ? maps.collections : maps.places).set(row.importKey, row);
  }

  return maps;
}

const keyState = (row: ImportKeyRow | undefined): ImportKeyState | undefined =>
  row === undefined
    ? undefined
    : {
        entityId: row.entityId,
        importedVersion: row.importedVersion,
        importedPlaces: row.importedPlaces,
      };

async function readPlace(
  tx: TransactionContext,
  deps: CatalogImportDeps,
  organizationId: string,
  key: ImportKeyRow | undefined,
): Promise<StoredPlace | null> {
  if (key === undefined) {
    return null;
  }

  const row = await deps.catalog.repository.findEditablePlace(tx, key.entityId);

  if (row === null || row.organizationId !== organizationId) {
    return null;
  }

  return {
    version: row.version,
    content: {
      name: row.name,
      description: row.description,
      address: row.address,
      accessInfo: row.accessInfo,
      latitude: row.latitude,
      longitude: row.longitude,
      visitRadiusM: row.visitRadiusM,
    },
  };
}

async function readCollection(
  tx: TransactionContext,
  deps: CatalogImportDeps,
  organizationId: string,
  key: ImportKeyRow | undefined,
  lock: boolean,
): Promise<StoredCollection | null> {
  if (key === undefined) {
    return null;
  }

  const row = await deps.catalog.repository.findEditableCollection(tx, key.entityId, { lock });

  if (row === null || row.organizationId !== organizationId) {
    return null;
  }

  return {
    version: row.version,
    status: row.status,
    content: { title: row.title, summary: row.summary, region: row.region },
    placeIds: await deps.catalog.repository.listCollectionPlaceIds(tx, key.entityId),
  };
}

/** Places named by a collection of the file but not described in it, that the organization lacks. */
async function countUnknownExternalKeys(
  tx: TransactionContext,
  deps: CatalogImportDeps,
  organizationId: string,
  keys: KeyMaps,
  file: ValidImportFile,
): Promise<number> {
  let missing = 0;

  for (const importKey of file.externalKeys) {
    if ((await readPlace(tx, deps, organizationId, keys.places.get(importKey))) === null) {
      missing += 1;
    }
  }

  return missing;
}

function count(counts: Record<string, number>, name: string): void {
  counts[name] = (counts[name] ?? 0) + 1;
}

async function previewImport(
  actor: Actor,
  organizationId: string,
  file: ValidImportFile,
  deps: CatalogImportDeps,
): Promise<CatalogImportOutcome> {
  return deps.catalog.withUserContext(actor, async (tx) => {
    await deps.imports.setReadOnly(tx);

    const keys = indexKeys(await deps.imports.readKeys(tx, organizationId));
    const unknown = await countUnknownExternalKeys(tx, deps, organizationId, keys, file);

    if (unknown > 0) {
      return { kind: "rejected", code: "unknown_external_key", count: unknown } as const;
    }

    const collections: Record<string, number> = {};
    const places: Record<string, number> = {};

    for (const place of file.places) {
      const key = keys.places.get(place.importKey);

      count(
        places,
        decidePlace(keyState(key), await readPlace(tx, deps, organizationId, key), place.input),
      );
    }

    for (const collection of file.collections) {
      const key = keys.collections.get(collection.importKey);
      const stored = await readCollection(tx, deps, organizationId, key, false);

      count(
        collections,
        decideCollection(keyState(key), stored, {
          title: collection.title,
          summary: collection.summary,
          region: collection.region,
        }).content,
      );
    }

    const existing = await deps.imports.countCollections(tx, organizationId);
    const preview: ImportPreview = {
      collections,
      places,
      orphanedKeys: await deps.imports.countOrphanedKeys(tx, organizationId),
      collectionLimitExceeded: existing + (collections.create ?? 0) > MAX_COLLECTIONS_PER_LIST,
    };

    return { kind: "preview", preview } as const;
  });
}

const collectionResult = (
  content: string,
  composition: CompositionResult | null,
): CollectionResult => {
  if (content === "create") {
    return "created";
  }
  if (content === "update" || (content === "noop" && composition === "synced")) {
    return "updated";
  }

  return content as CollectionResult;
};

// One collection, in one transaction. Throws `CollectionRefusal` to roll it back.
async function loadCollection(
  actor: Actor,
  organizationId: string,
  batchId: string,
  collection: ImportCollection,
  filePlaces: ReadonlyMap<string, ImportPlace>,
  deps: CatalogImportDeps,
  tx: TransactionContext,
): Promise<CollectionReport> {
  const repository = deps.catalog.repository;

  // The lock first; keys, versions and composition are read only after it.
  await deps.imports.lockImport(tx, organizationId);

  const keys = indexKeys(await deps.imports.readKeys(tx, organizationId));
  const bound = bindDepsToTransaction(tx, actor, deps.catalog);
  const collectionKey = keys.collections.get(collection.importKey);
  const stored = await readCollection(tx, deps, organizationId, collectionKey, true);
  const wanted = {
    title: collection.title,
    summary: collection.summary,
    region: collection.region,
  };
  const decision = decideCollection(keyState(collectionKey), stored, wanted);
  const report = (
    result: CollectionResult,
    composition: CompositionResult | null,
    places: readonly PlaceReport[],
  ): CollectionReport => ({
    importKey: collection.importKey,
    line: collection.line,
    result,
    composition,
    places,
  });

  if (decision.content === "kept_manual_delete") {
    return report("kept_manual_delete", "kept_manual_delete", []);
  }

  let collectionId: string;

  if (decision.content === "create") {
    collectionId = must(await createCollection(actor, { organizationId, ...wanted }, bound)).id;
  } else {
    collectionId = (collectionKey as ImportKeyRow).entityId;

    if (decision.content === "update") {
      must(
        await updateCollection(
          actor,
          collectionId,
          { ...wanted, version: (stored as StoredCollection).version },
          bound,
        ),
      );
    }
  }

  const sync = decision.composition === "sync";
  const desired: string[] = [];
  const external = new Map<string, string>();
  const placeReports: PlaceReport[] = [];
  let changed = decision.content === "create";

  for (const placeKey of collection.placeKeys) {
    const filePlace = filePlaces.get(placeKey);
    const key = keys.places.get(placeKey);

    if (filePlace === undefined) {
      // A place of the organization loaded earlier (outside this file).
      if ((await readPlace(tx, deps, organizationId, key)) === null) {
        throw new CollectionRefusal("not_found");
      }

      desired.push((key as ImportKeyRow).entityId);
      external.set(placeKey, (key as ImportKeyRow).entityId);
      continue;
    }

    const storedPlace = await readPlace(tx, deps, organizationId, key);
    const placeDecision = decidePlace(keyState(key), storedPlace, filePlace.input);
    let result: PlaceResult;

    if (placeDecision === "create") {
      if (!sync) {
        placeReports.push({ importKey: placeKey, result: "skipped_collection_kept" });
        continue;
      }

      const added = must(await addPlace(actor, collectionId, { ...filePlace.input }, bound));
      const row = await repository.findEditablePlace(tx, added.placeId);

      await deps.imports.insertKey(tx, organizationId, "place", placeKey, {
        entityId: added.placeId,
        batchId,
        importedVersion: (row as { version: number }).version,
        importedPlaces: null,
      });
      desired.push(added.placeId);
      changed = true;
      result = "created";
    } else if (placeDecision === "update") {
      const entityId = (key as ImportKeyRow).entityId;
      const row = must(
        await updatePlace(
          actor,
          entityId,
          { ...filePlace.input, version: (storedPlace as StoredPlace).version },
          bound,
        ),
      );

      await deps.imports.updateKey(tx, organizationId, "place", placeKey, {
        entityId,
        batchId,
        importedVersion: row.version,
        importedPlaces: null,
      });
      desired.push(entityId);
      result = "updated";
    } else {
      if (placeDecision !== "kept_manual_delete") {
        desired.push((key as ImportKeyRow).entityId);
      }
      result = placeDecision;
    }

    placeReports.push({ importKey: placeKey, result });
  }

  let composition: CompositionResult | null;

  if (sync) {
    const current = await repository.listCollectionPlaceIds(tx, collectionId);
    const diff = diffComposition(current, desired);

    for (const placeId of diff.remove) {
      must(await removePlaceFromCollection(actor, collectionId, placeId, bound));
    }
    for (const placeId of diff.add) {
      must(await addPlace(actor, collectionId, { placeId }, bound));
    }
    if (diff.reorder) {
      must(await reorderPlaces(actor, collectionId, { placeIds: desired }, bound));
    }

    for (const [importKey, entityId] of external) {
      placeReports.push({
        importKey,
        result: current.includes(entityId) ? "noop" : "linked_existing",
      });
    }

    composition =
      changed || diff.remove.length > 0 || diff.add.length > 0 || diff.reorder ? "synced" : "noop";
  } else {
    for (const importKey of external.keys()) {
      placeReports.push({ importKey, result: "skipped_collection_kept" });
    }
    composition = decision.composition as CompositionResult;
  }

  // What the loader leaves behind: the version and, when it synced the
  // composition, the places in order.
  const row = await repository.findEditableCollection(tx, collectionId);
  const importedVersion =
    decision.content === "create" || decision.content === "update"
      ? (row as { version: number }).version
      : (collectionKey as ImportKeyRow).importedVersion;
  const importedPlaces = sync
    ? await repository.listCollectionPlaceIds(tx, collectionId)
    : (collectionKey as ImportKeyRow).importedPlaces;
  const values = { entityId: collectionId, batchId, importedVersion, importedPlaces };

  if (collectionKey === undefined) {
    await deps.imports.insertKey(tx, organizationId, "collection", collection.importKey, values);
  } else if (
    importedVersion !== collectionKey.importedVersion ||
    !sameIds(importedPlaces ?? [], collectionKey.importedPlaces ?? [])
  ) {
    await deps.imports.updateKey(tx, organizationId, "collection", collection.importKey, values);
  }

  return report(collectionResult(decision.content, composition), composition, placeReports);
}

export async function executeCatalogImport(
  request: CatalogImportRequest,
  deps: CatalogImportDeps,
): Promise<CatalogImportOutcome> {
  const { actor, file } = request;

  // The organization by its short name, and only when the actor may edit it:
  // a missing organization, a suspended one and a foreign one look the same.
  const organizationId = await deps.catalog.withUserContext(actor, async (tx) => {
    const id = await deps.imports.findOrganizationIdBySlug(tx, request.orgSlug);

    if (id === null) {
      return null;
    }

    return (await deps.catalog.repository.permittedOrganizationIds(tx)).includes(id) ? id : null;
  });

  if (organizationId === null) {
    return { kind: "refused", code: "organization_unavailable" };
  }

  if (request.preview) {
    return previewImport(actor, organizationId, file, deps);
  }

  // Nothing is written when the file names a place the organization lacks.
  const unknown = await deps.catalog.withUserContext(actor, async (tx) => {
    await deps.imports.lockImport(tx, organizationId);

    return countUnknownExternalKeys(
      tx,
      deps,
      organizationId,
      indexKeys(await deps.imports.readKeys(tx, organizationId)),
      file,
    );
  });

  if (unknown > 0) {
    return { kind: "rejected", code: "unknown_external_key", count: unknown };
  }

  const filePlaces = new Map(file.places.map((place) => [place.importKey, place]));
  const reports: CollectionReport[] = [];

  for (const collection of file.collections) {
    try {
      reports.push(
        await deps.catalog.withUserContext(actor, (tx) =>
          loadCollection(
            actor,
            organizationId,
            file.batch.batchId,
            collection,
            filePlaces,
            deps,
            tx,
          ),
        ),
      );
    } catch (error) {
      if (!(error instanceof CollectionRefusal)) {
        throw error;
      }

      reports.push({
        importKey: collection.importKey,
        line: collection.line,
        result: "refused",
        composition: null,
        refusal: error.reason,
        places: [],
      });
    }
  }

  return { kind: "done", batchId: file.batch.batchId, collections: reports };
}
