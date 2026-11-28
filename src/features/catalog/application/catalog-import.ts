import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import {
  decideCollection,
  decideExtraRegions,
  decideKind,
  decidePlace,
  diffComposition,
  sameIds,
  type ImportKeyState,
  type StoredCollection,
  type StoredPlace,
} from "../domain/import-diff";
import type { Region } from "../domain/collection";
import type { ImportCollection, ImportFileResult, ImportPlace } from "../domain/import-file";
import {
  decidePhoto,
  photoContentOf,
  photoImportKey,
  type PhotoResult,
} from "../domain/import-photo";
import { MAX_COLLECTIONS_PER_LIST } from "../domain/limits";
import {
  composeAttribution,
  descriptionMethodOf,
  wikidataQidOf,
  type SourceLabel,
} from "../domain/place-sources";
import type {
  CatalogImportDeps,
  CatalogImportOutcome,
  CollectionReport,
  CollectionResult,
  CompositionResult,
  ExtraRegionsResult,
  ImportKeyRow,
  ImportPreview,
  KindResult,
  PlaceReport,
  PlaceResult,
  PublicationResult,
  PublishableCollection,
  RemovalReport,
} from "./catalog-import-types";
import type { CatalogDeps, CuratorOutcome } from "./catalog-types";
import { addPlace, removePlaceFromCollection, reorderPlaces, updatePlace } from "./curator-places";
import {
  createCollection,
  deleteDraftCollection,
  publishCollection,
  updateCollection,
} from "./curator-collections";

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
  /** After loading, publishes the collections marked `publish: true` that were never published and not edited by hand. */
  publish?: boolean;
}>;

export type CatalogRemoveRequest = Readonly<{
  actor: Actor;
  orgSlug: string;
  file: ValidImportFile;
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
  photos: Map<string, ImportKeyRow>;
}>;

function indexKeys(rows: readonly ImportKeyRow[]): KeyMaps {
  const maps: KeyMaps = { collections: new Map(), places: new Map(), photos: new Map() };

  for (const row of rows) {
    const target =
      row.kind === "collection"
        ? maps.collections
        : row.kind === "photo"
          ? maps.photos
          : maps.places;

    target.set(row.importKey, row);
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
      accessRestriction: row.accessRestriction,
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
    firstPublishedAt: row.firstPublishedAt,
    content: { title: row.title, summary: row.summary, region: row.region },
    extraRegions: row.extraRegions,
    kind: row.kind,
    placeIds: await deps.catalog.repository.listCollectionPlaceIds(tx, key.entityId),
  };
}

// The extra voivodeships the file asks for, without the main one that will stand in the
// database (the SQL of `setExtraRegions` drops it too, so the next load finds the same list).
const extraRegionsWanted = (
  wanted: ImportCollection["extraRegions"],
  mainRegion: Region,
): readonly Region[] | null =>
  wanted === null ? null : wanted.filter((region) => region !== mainRegion);

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

/**
 * The photo block of one place that already exists (E4-2a). Rows made earlier from a file whose
 * key is not the wanted one are removed (the block went or the Commons file changed) unless edited
 * by hand; the wanted photo is created, updated or left as `decidePhoto` says. `apply: false` only
 * reports (the preview). A row the app cannot read in detail (no `commons_file`) is found by its key.
 */
async function syncPlacePhotos(
  tx: TransactionContext,
  deps: CatalogImportDeps,
  organizationId: string,
  batchId: string,
  placeId: string,
  filePlace: ImportPlace,
  keys: KeyMaps,
  apply: boolean,
): Promise<PhotoResult[]> {
  const rows = await deps.imports.readPlacePhotos(tx, placeId);
  const results: PhotoResult[] = [];
  const wanted = filePlace.image;
  const wantedKey =
    wanted === null ? null : photoImportKey(filePlace.importKey, wanted.commonsFile);
  const keyByEntity = new Map([...keys.photos.values()].map((row) => [row.entityId, row] as const));

  for (const row of rows) {
    const key = keyByEntity.get(row.id);

    if (key === undefined || key.importKey === wantedKey) {
      continue;
    }

    if (row.version !== key.importedVersion) {
      results.push("kept_manual_edit");
      continue;
    }

    if (apply) {
      await deps.imports.deletePlacePhoto(tx, row.id);
      await deps.imports.deleteKey(tx, organizationId, "photo", key.importKey);
    }

    results.push("removed");
  }

  if (filePlace.imageSkipped) {
    results.push("skipped_unknown_license");
  }

  if (wanted === null || wantedKey === null) {
    return results;
  }

  const content = photoContentOf(wanted);
  const key = keys.photos.get(wantedKey);
  const stored = key === undefined ? null : (rows.find((row) => row.id === key.entityId) ?? null);
  const decision = decidePhoto(keyState(key), stored, content);

  if (decision === "create") {
    if (!apply) {
      results.push("created");
    } else {
      const inserted = await deps.imports.insertPlacePhoto(
        tx,
        organizationId,
        placeId,
        content,
        wanted.retrievedAt,
      );

      if (inserted === null) {
        // The place already has this Commons file, made outside the loader: nothing to add.
        results.push("noop");
      } else {
        await deps.imports.insertKey(tx, organizationId, "photo", wantedKey, {
          entityId: inserted.id,
          batchId,
          importedVersion: inserted.version,
          importedPlaces: null,
        });
        results.push("created");
      }
    }
  } else if (decision === "update") {
    if (apply) {
      const version = await deps.imports.updatePlacePhoto(
        tx,
        (stored as { id: string }).id,
        content,
        (stored as { version: number }).version,
      );

      await deps.imports.updateKey(tx, organizationId, "photo", wantedKey, {
        entityId: (key as ImportKeyRow).entityId,
        batchId,
        importedVersion: version,
        importedPlaces: null,
      });
    }

    results.push("updated");
  } else {
    results.push(decision);
  }

  return results;
}

async function previewImport(
  actor: Actor,
  organizationId: string,
  file: ValidImportFile,
  deps: CatalogImportDeps,
  publish: boolean,
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
    const photos: Record<string, number> = {};
    const publishable: PublishableCollection[] = [];
    let extraRegionsUpdated = 0;
    let kindUpdated = 0;

    for (const place of file.places) {
      const key = keys.places.get(place.importKey);
      const decision = decidePlace(
        keyState(key),
        await readPlace(tx, deps, organizationId, key),
        place.input,
      );

      count(places, decision);

      if (decision === "create") {
        // A new place has no photo rows yet: everything with a valid licence would be created.
        if (place.image !== null) count(photos, "created");
        if (place.imageSkipped) count(photos, "skipped_unknown_license");
      } else if (decision !== "kept_manual_delete") {
        for (const result of await syncPlacePhotos(
          tx,
          deps,
          organizationId,
          file.batch.batchId,
          (key as ImportKeyRow).entityId,
          place,
          keys,
          false,
        )) {
          count(photos, result);
        }
      }
    }

    for (const collection of file.collections) {
      const key = keys.collections.get(collection.importKey);
      const stored = await readCollection(tx, deps, organizationId, key, false);

      const decision = decideCollection(keyState(key), stored, {
        title: collection.title,
        summary: collection.summary,
        region: collection.region,
      });

      count(collections, decision.content);

      // A new collection starts without extra voivodeships; a deleted one is left alone.
      if (key === undefined || stored !== null) {
        const mainAfter =
          decision.content === "create" || decision.content === "update"
            ? collection.region
            : (stored as StoredCollection).content.region;

        if (
          decideExtraRegions(
            stored === null ? [] : (stored.extraRegions ?? []),
            extraRegionsWanted(collection.extraRegions, mainAfter),
          ) === "set"
        ) {
          extraRegionsUpdated += 1;
        }

        // A new collection starts as a theme collection.
        if (
          decideKind(stored === null ? "theme" : (stored.kind ?? "theme"), collection.kind) ===
          "set"
        ) {
          kindUpdated += 1;
        }
      }

      if (
        collection.publish &&
        decision.composition === "sync" &&
        (stored === null || stored.firstPublishedAt === null)
      ) {
        publishable.push({
          line: collection.line,
          importKey: collection.importKey,
          title: collection.title,
        });
      }
    }

    const existing = await deps.imports.countCollections(tx, organizationId);
    const preview: ImportPreview = {
      collections,
      places,
      photos,
      orphanedKeys: await deps.imports.countOrphanedKeys(tx, organizationId),
      collectionLimitExceeded: existing + (collections.create ?? 0) > MAX_COLLECTIONS_PER_LIST,
      ...(extraRegionsUpdated > 0 ? { extraRegions: { updated: extraRegionsUpdated } } : {}),
      ...(kindUpdated > 0 ? { kind: { updated: kindUpdated } } : {}),
      ...(publish ? { publishable } : {}),
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
  sources: ReadonlyMap<string, SourceLabel>,
  deps: CatalogImportDeps,
  publish: boolean,
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

  // The source of a place of the file (`place_sources`): none when the record names no source.
  const writeSource = async (
    placeId: string,
    filePlace: ImportPlace,
    mode: "replace" | "refresh",
  ): Promise<void> => {
    const attribution = composeAttribution(filePlace.attribution, sources);

    if (attribution === null) {
      return;
    }

    await deps.imports.writePlaceSource(
      tx,
      organizationId,
      placeId,
      {
        wikidataQid: wikidataQidOf(filePlace.importKey),
        wikipediaUrl: filePlace.wikipediaUrl,
        descriptionMethod: descriptionMethodOf(filePlace.descriptionMethod),
        attribution,
        retrievedAt: filePlace.retrievedAt,
      },
      mode,
    );
  };

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
    // The place the photo block belongs to; stays `null` when the place was not loaded.
    let photoPlaceId: string | null = null;

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
      await writeSource(added.placeId, filePlace, "replace");
      desired.push(added.placeId);
      photoPlaceId = added.placeId;
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
      await writeSource(entityId, filePlace, "replace");
      desired.push(entityId);
      photoPlaceId = entityId;
      result = "updated";
    } else {
      if (placeDecision !== "kept_manual_delete") {
        // Unchanged or edited by hand: the signature and links follow the file (a change of a
        // source label or licence must reach the place), the description method stays.
        await writeSource((key as ImportKeyRow).entityId, filePlace, "refresh");
        desired.push((key as ImportKeyRow).entityId);
        photoPlaceId = (key as ImportKeyRow).entityId;
      }
      result = placeDecision;
    }

    const photos =
      photoPlaceId === null
        ? []
        : await syncPlacePhotos(
            tx,
            deps,
            organizationId,
            batchId,
            photoPlaceId,
            filePlace,
            keys,
            true,
          );

    placeReports.push({
      importKey: placeKey,
      result,
      ...(photos.length === 0 ? {} : { photos }),
    });
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

  // Extra voivodeships: only when the file names them, also in a published collection (a place
  // in the filter, not content: `version` stays, so the key of the load still fits). Read after
  // the content step: a new main voivodeship has already left the list.
  let extraRegionsResult: ExtraRegionsResult | undefined;

  if (collection.extraRegions !== null) {
    const current = await repository.findEditableCollection(tx, collectionId);

    if (current === null) {
      throw new CollectionRefusal("not_found");
    }

    const wantedExtra = extraRegionsWanted(collection.extraRegions, current.region);

    if (decideExtraRegions(current.extraRegions, wantedExtra) === "set") {
      if (!(await repository.setExtraRegions(tx, collectionId, wantedExtra as readonly Region[]))) {
        throw new CollectionRefusal("not_found");
      }

      extraRegionsResult = "updated";
    } else {
      extraRegionsResult = "unchanged";
    }
  }

  // Kind (land or theme): only when the file names it, also in a published collection (an order
  // of the catalog, not content: `version` stays). A new collection was created as a theme.
  let kindResult: KindResult | undefined;

  if (collection.kind !== null) {
    const current = await repository.findEditableCollection(tx, collectionId);

    if (current === null) {
      throw new CollectionRefusal("not_found");
    }

    if (decideKind(current.kind, collection.kind) === "set") {
      if (!(await repository.setKind(tx, collectionId, collection.kind))) {
        throw new CollectionRefusal("not_found");
      }

      kindResult = "updated";
    } else {
      kindResult = "unchanged";
    }
  }

  // What the loader leaves behind: the version and, when it synced the
  // composition, the places in order.
  const row = await repository.findEditableCollection(tx, collectionId);
  let publication: PublicationResult | undefined;
  let publicationRefusal: string | undefined;
  let publishedVersion: number | undefined;

  if (publish && collection.publish) {
    // Only through the use case of the panel: it checks the version, the rule
    // of at least one place and gives the address from the title (D-27). A
    // refusal writes nothing, so the loaded draft stays.
    if (
      decision.content === "skipped_already_published" ||
      decision.content === "kept_manual_edit" ||
      decision.composition === "kept_manual_edit"
    ) {
      publication =
        decision.content === "skipped_already_published"
          ? "skipped_already_published"
          : "kept_manual_edit";
    } else {
      const outcome = await publishCollection(
        actor,
        collectionId,
        { version: (row as { version: number }).version },
        bound,
      );

      if (outcome.status === "ok") {
        publication = "published";
        publishedVersion = outcome.value.version;
      } else {
        publication = "refused";
        publicationRefusal =
          "reason" in outcome ? `${outcome.status}:${outcome.reason}` : outcome.status;
      }
    }
  }

  const importedVersion =
    publishedVersion ??
    (decision.content === "create" || decision.content === "update"
      ? (row as { version: number }).version
      : (collectionKey as ImportKeyRow).importedVersion);
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

  return {
    ...report(collectionResult(decision.content, composition), composition, placeReports),
    ...(publication === undefined ? {} : { publication }),
    ...(publicationRefusal === undefined ? {} : { publicationRefusal }),
    ...(extraRegionsResult === undefined ? {} : { extraRegions: extraRegionsResult }),
    ...(kindResult === undefined ? {} : { kind: kindResult }),
  };
}

// The organization by its short name, and only when the actor may edit it:
// a missing organization, a suspended one and a foreign one look the same.
function resolveOrganization(
  actor: Actor,
  orgSlug: string,
  deps: CatalogImportDeps,
): Promise<string | null> {
  return deps.catalog.withUserContext(actor, async (tx) => {
    const id = await deps.imports.findOrganizationIdBySlug(tx, orgSlug);

    if (id === null) {
      return null;
    }

    return (await deps.catalog.repository.permittedOrganizationIds(tx)).includes(id) ? id : null;
  });
}

/**
 * `--remove`: removes what the file loaded, by its keys, only before
 * publication (a published collection is never deleted). One transaction for the organization, the lock first.
 * Collections go through `deleteDraftCollection` (a published or withdrawn
 * one stays, with its key); a place goes only when it belongs to no
 * collection (policy `places_delete`) and nobody visited it (23503 means it
 * stays). Keys of entities that no longer exist are removed. Places named in
 * the file only as keys of other loads are not candidates.
 */
export async function executeCatalogRemove(
  request: CatalogRemoveRequest,
  deps: CatalogImportDeps,
): Promise<CatalogImportOutcome> {
  const { actor, file } = request;
  const organizationId = await resolveOrganization(actor, request.orgSlug, deps);

  if (organizationId === null) {
    return { kind: "refused", code: "organization_unavailable" };
  }

  try {
    const reports = await deps.catalog.withUserContext(actor, async (tx) => {
      await deps.imports.lockImport(tx, organizationId);

      const keys = indexKeys(await deps.imports.readKeys(tx, organizationId));
      const bound = bindDepsToTransaction(tx, actor, deps.catalog);
      const out: RemovalReport[] = [];

      for (const collection of file.collections) {
        const key = keys.collections.get(collection.importKey);
        const base = {
          importKey: collection.importKey,
          kind: "collection",
          line: collection.line,
        } as const;

        if (key === undefined) {
          out.push({ ...base, result: "noop" });
          continue;
        }

        const outcome = await deleteDraftCollection(actor, key.entityId, bound);

        // `was_published` is also what a concurrent change outside the import
        // lock looks like (nothing is deleted, so the label is safe).
        if (outcome.status === "conflict" && outcome.reason === "was_published") {
          out.push({ ...base, result: "kept_published" });
          continue;
        }

        // Gone or invisible (deleted in the panel): only the orphaned key goes.
        if (outcome.status !== "ok" && outcome.status !== "not_found") {
          must(outcome);
        }

        await deps.imports.deleteKey(tx, organizationId, "collection", collection.importKey);
        out.push({
          ...base,
          result: outcome.status === "ok" ? "removed" : "orphan_key_removed",
        });
      }

      // After the collections: a place that was only in a removed draft is free now.
      for (const place of file.places) {
        const key = keys.places.get(place.importKey);
        const base = { importKey: place.importKey, kind: "place", line: place.line } as const;

        if (key === undefined) {
          out.push({ ...base, result: "noop" });
          continue;
        }

        if ((await readPlace(tx, deps, organizationId, key)) === null) {
          await deps.imports.deleteKey(tx, organizationId, "place", place.importKey);
          out.push({ ...base, result: "orphan_key_removed" });
          continue;
        }

        // The photo rows go with the place (cascade); their keys go after it.
        const photoIds = new Set(
          (await deps.imports.readPlacePhotos(tx, key.entityId)).map((photo) => photo.id),
        );
        const deleted = await deps.imports.deletePlace(tx, key.entityId);

        if (deleted === "deleted") {
          await deps.imports.deleteKey(tx, organizationId, "place", place.importKey);

          for (const photoKey of keys.photos.values()) {
            if (photoIds.has(photoKey.entityId)) {
              await deps.imports.deleteKey(tx, organizationId, "photo", photoKey.importKey);
            }
          }
        }

        // "blocked" means the row policy kept the place (it is in a collection);
        // anything else is a reference from a visit or a want-to-see entry.
        out.push({
          ...base,
          result:
            deleted === "deleted"
              ? "removed"
              : deleted === "blocked"
                ? "kept_in_collection"
                : "kept_referenced",
        });
      }

      return out;
    });

    return { kind: "removed", reports };
  } catch (error) {
    if (!(error instanceof CollectionRefusal)) {
      throw error;
    }

    return { kind: "refused", code: "removal_refused", reason: error.reason };
  }
}

export async function executeCatalogImport(
  request: CatalogImportRequest,
  deps: CatalogImportDeps,
): Promise<CatalogImportOutcome> {
  const { actor, file } = request;
  const organizationId = await resolveOrganization(actor, request.orgSlug, deps);

  if (organizationId === null) {
    return { kind: "refused", code: "organization_unavailable" };
  }

  if (request.preview) {
    return previewImport(actor, organizationId, file, deps, request.publish === true);
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
  const sources = new Map(file.batch.sources.map((source) => [source.key, source] as const));
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
            sources,
            deps,
            request.publish === true,
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
