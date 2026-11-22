import type { TransactionContext } from "@/lib/db/user-context";

import type { PhotoContent, PhotoResult, StoredPhoto } from "../domain/import-photo";
import type { DescriptionMethod } from "../domain/place-sources";
import type { CatalogDeps } from "./catalog-types";

export type ImportEntityKind = "collection" | "place" | "photo";

/** A photo row of a place loaded from a file (`commons_import`), as the curator may read it. */
export type PlacePhotoRow = Readonly<{ id: string; position: number } & StoredPhoto>;

/** A row of `catalog_import_keys` as the loader reads it. */
export type ImportKeyRow = Readonly<{
  kind: ImportEntityKind;
  importKey: string;
  entityId: string;
  batchId: string;
  importedVersion: number;
  importedPlaces: readonly string[] | null;
}>;

export type ImportKeyValues = Readonly<{
  entityId: string;
  batchId: string;
  importedVersion: number;
  importedPlaces: readonly string[] | null;
}>;

export type PlaceSourceValues = Readonly<{
  wikidataQid: string | null;
  wikipediaUrl: string | null;
  descriptionMethod: DescriptionMethod;
  attribution: string;
  retrievedAt: string;
}>;

// Database access of the loader that the catalog repository does not have.
// Every method runs on the transaction the use case opened in the context of
// the curator, so the row policies decide what each statement sees or changes.
export interface CatalogImportRepository {
  /**
   * Transaction-level advisory lock `catalog_import:<organizationId>`: the
   * first statement of every transaction of the loader. The key differs from
   * the one `countOrganizationCollections` takes, so the order is always
   * import first, collections second (no deadlock with the panel).
   */
  lockImport(tx: TransactionContext, organizationId: string): Promise<void>;
  /** Makes the rest of the transaction read only (the preview). */
  setReadOnly(tx: TransactionContext): Promise<void>;
  findOrganizationIdBySlug(tx: TransactionContext, slug: string): Promise<string | null>;
  readKeys(tx: TransactionContext, organizationId: string): Promise<readonly ImportKeyRow[]>;
  insertKey(
    tx: TransactionContext,
    organizationId: string,
    kind: ImportEntityKind,
    importKey: string,
    values: ImportKeyValues,
  ): Promise<void>;
  updateKey(
    tx: TransactionContext,
    organizationId: string,
    kind: ImportEntityKind,
    importKey: string,
    values: ImportKeyValues,
  ): Promise<void>;
  /** Removes one key row (a removed entity or an orphaned key); throws when no row went. */
  deleteKey(
    tx: TransactionContext,
    organizationId: string,
    kind: ImportEntityKind,
    importKey: string,
  ): Promise<void>;
  /**
   * Deletes a place in a savepoint: `deleted`; `blocked` when the row policy
   * `places_delete` hides it (it belongs to a collection) so no row went;
   * `referenced` on 23503 (a visit or a wish list entry, invisible to the
   * curator): the savepoint is rolled back and the transaction stays usable.
   */
  deletePlace(
    tx: TransactionContext,
    placeId: string,
  ): Promise<"deleted" | "blocked" | "referenced">;
  /**
   * Writes the source of a place (`place_sources`). `replace` sets every column (the loader
   * has just written the content of the place); `refresh` adds the row or refreshes its
   * signature and links, but keeps `description_method`, so a description marked `curator`
   * in the panel is not turned back.
   */
  writePlaceSource(
    tx: TransactionContext,
    organizationId: string,
    placeId: string,
    values: PlaceSourceValues,
    mode: "replace" | "refresh",
  ): Promise<void>;
  /** Collections of the organization the curator sees (no lock; for the preview). */
  countCollections(tx: TransactionContext, organizationId: string): Promise<number>;
  /** Keys whose entity is gone or not visible (deleted in the panel). */
  countOrphanedKeys(
    tx: TransactionContext,
    organizationId: string,
  ): Promise<Readonly<Record<"collection" | "place", number>>>;
  /** Photos of a place that came from a file (`commons_import`), by position. */
  readPlacePhotos(tx: TransactionContext, placeId: string): Promise<readonly PlacePhotoRow[]>;
  /**
   * Inserts a row `commons_import` / `pending_fetch` without a file, at the end of the list of the
   * place. `null` when the place already has that Commons file (the unique key), so nothing is added.
   */
  insertPlacePhoto(
    tx: TransactionContext,
    organizationId: string,
    placeId: string,
    content: PhotoContent,
    retrievedAt: string,
  ): Promise<Readonly<{ id: string; version: number }> | null>;
  /** Updates the signature columns; returns the new version (throws when no row changed). */
  updatePlacePhoto(
    tx: TransactionContext,
    photoId: string,
    content: PhotoContent,
    version: number,
  ): Promise<number>;
  /** Deletes a photo row (the file is removed later by the cleaning command); throws when no row went. */
  deletePlacePhoto(tx: TransactionContext, photoId: string): Promise<void>;
}

export type CatalogImportDeps = Readonly<{
  catalog: CatalogDeps;
  imports: CatalogImportRepository;
}>;

export type PlaceResult =
  | "created"
  | "updated"
  | "noop"
  | "linked_existing"
  | "kept_manual_edit"
  | "kept_manual_delete"
  | "skipped_collection_kept";

export type CollectionResult =
  | "created"
  | "updated"
  | "noop"
  | "kept_manual_edit"
  | "kept_manual_delete"
  | "skipped_already_published"
  | "refused";

export type CompositionResult =
  "synced" | "noop" | "kept_manual_edit" | "kept_manual_delete" | "skipped_already_published";

export type PublicationResult =
  "published" | "skipped_already_published" | "kept_manual_edit" | "refused";

export type RemovalResult =
  | "removed"
  | "orphan_key_removed"
  | "kept_published"
  | "kept_in_collection"
  | "kept_referenced"
  | "noop";

export type RemovalReport = Readonly<{
  importKey: string;
  kind: ImportEntityKind;
  line: number;
  result: RemovalResult;
}>;

export type PlaceReport = Readonly<{
  importKey: string;
  result: PlaceResult;
  /** Results for the photo block of the place (empty or absent when there is nothing to report). */
  photos?: readonly PhotoResult[];
}>;

export type CollectionReport = Readonly<{
  importKey: string;
  line: number;
  result: CollectionResult;
  composition: CompositionResult | null;
  /** Set when a use case refused (e.g. `conflict:too_many_collections`); the collection was rolled back. */
  refusal?: string;
  /** Only with `--publish` for a collection marked `publish: true`; a refusal keeps the loaded draft. */
  publication?: PublicationResult;
  publicationRefusal?: string;
  places: readonly PlaceReport[];
}>;

export type PublishableCollection = Readonly<{ line: number; importKey: string; title: string }>;

export type ImportPreview = Readonly<{
  collections: Readonly<Record<string, number>>;
  places: Readonly<Record<string, number>>;
  /** Results for photo blocks (`created`, `noop`, ...), counted like the places. */
  photos?: Readonly<Record<string, number>>;
  orphanedKeys: Readonly<Record<"collection" | "place", number>>;
  /** True when the new collections would not fit in the limit of the organization. */
  collectionLimitExceeded: boolean;
  /** With `--publish`: collections marked `publish: true` that a load would publish now. */
  publishable?: readonly PublishableCollection[];
}>;

export type CatalogImportOutcome =
  /** The organization is not found or the curator may not edit it (one answer for both). */
  | Readonly<{
      kind: "refused";
      code: "organization_unavailable" | "curator_not_found" | "removal_refused";
      /** `status[:reason]` of the use case that refused (removal only). */
      reason?: string;
    }>
  | Readonly<{ kind: "removed"; reports: readonly RemovalReport[] }>
  /** The file names a place outside it that the organization does not have. */
  | Readonly<{ kind: "rejected"; code: "unknown_external_key"; count: number }>
  | Readonly<{ kind: "preview"; preview: ImportPreview }>
  | Readonly<{ kind: "done"; batchId: string; collections: readonly CollectionReport[] }>;
