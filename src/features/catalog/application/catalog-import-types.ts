import type { TransactionContext } from "@/lib/db/user-context";

import type { CatalogDeps } from "./catalog-types";

export type ImportEntityKind = "collection" | "place";

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
  /** Collections of the organization the curator sees (no lock; for the preview). */
  countCollections(tx: TransactionContext, organizationId: string): Promise<number>;
  /** Keys whose entity is gone or not visible (deleted in the panel). */
  countOrphanedKeys(
    tx: TransactionContext,
    organizationId: string,
  ): Promise<Readonly<Record<ImportEntityKind, number>>>;
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

export type PlaceReport = Readonly<{ importKey: string; result: PlaceResult }>;

export type CollectionReport = Readonly<{
  importKey: string;
  line: number;
  result: CollectionResult;
  composition: CompositionResult | null;
  /** Set when a use case refused (e.g. `conflict:too_many_collections`); the collection was rolled back. */
  refusal?: string;
  places: readonly PlaceReport[];
}>;

export type ImportPreview = Readonly<{
  collections: Readonly<Record<string, number>>;
  places: Readonly<Record<string, number>>;
  orphanedKeys: Readonly<Record<ImportEntityKind, number>>;
  /** True when the new collections would not fit in the limit of the organization. */
  collectionLimitExceeded: boolean;
}>;

export type CatalogImportOutcome =
  /** The organization is not found or the curator may not edit it (one answer for both). */
  | Readonly<{ kind: "refused"; code: "organization_unavailable" | "curator_not_found" }>
  /** The file names a place outside it that the organization does not have. */
  | Readonly<{ kind: "rejected"; code: "unknown_external_key"; count: number }>
  | Readonly<{ kind: "preview"; preview: ImportPreview }>
  | Readonly<{ kind: "done"; batchId: string; collections: readonly CollectionReport[] }>;
