import { createHash } from "node:crypto";

import type {
  AuditErrorCode,
  AuditOutcome,
  OperatorAuditOperation,
} from "@/lib/db/operations-audit";

import type { CatalogImportOutcome } from "./catalog-import-types";

// What the server loader writes to the operations audit (spec 5.6 pt 5): an
// entry "start" before the first write and an entry with the result after it.
// Pure: the numbers and identifiers of the batch only. Never an e-mail, a
// title, a place key or the text of the file (the audit cannot be edited, so
// it carries no personal data).

export type ImportAuditBatch = Readonly<{
  operation: Extract<OperatorAuditOperation, "catalog_import" | "catalog_remove">;
  batchId: string;
  fileSha256: string;
  collections: number;
  places: number;
  /** D-68: the load also publishes (`--publish`); absent or false for a plain load. */
  publish?: boolean;
}>;

// A load with publication carries `publish: true` in both entries; a plain
// load leaves the key out, so its entries keep the earlier shape.
const publishMark = (batch: ImportAuditBatch) => (batch.publish === true ? { publish: true } : {});

export type ImportAuditResult = Readonly<{
  outcome: AuditOutcome;
  code: AuditErrorCode | null;
  details: Record<string, unknown>;
}>;

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function startDetails(batch: ImportAuditBatch): Record<string, unknown> {
  return {
    phase: "start",
    batch_id: batch.batchId,
    file_sha256: batch.fileSha256,
    profile: "public",
    collections: batch.collections,
    places: batch.places,
    ...publishMark(batch),
  };
}

const count = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

function finishBase(batch: ImportAuditBatch, startEntryId: string): Record<string, unknown> {
  return {
    phase: "finish",
    start_entry_id: startEntryId,
    batch_id: batch.batchId,
    file_sha256: batch.fileSha256,
    ...publishMark(batch),
  };
}

/** The result entry of a load that ended without an exception. */
export function resultOfOutcome(
  batch: ImportAuditBatch,
  startEntryId: string,
  outcome: CatalogImportOutcome,
): ImportAuditResult {
  const base = finishBase(batch, startEntryId);

  switch (outcome.kind) {
    case "done": {
      const collections: Record<string, number> = {};
      const places: Record<string, number> = {};
      const photos: Record<string, number> = {};
      const publications: Record<string, number> = {};
      let extraRegionsUpdated = 0;

      for (const collection of outcome.collections) {
        count(collections, collection.result);

        if (collection.publication !== undefined) {
          count(publications, collection.publication);
        }

        if (collection.extraRegions === "updated") {
          extraRegionsUpdated += 1;
        }

        for (const place of collection.places) {
          count(places, place.result);

          for (const photo of place.photos ?? []) {
            count(photos, photo);
          }
        }
      }

      return {
        outcome: "applied",
        code: null,
        details: {
          ...base,
          collection_results: collections,
          place_results: places,
          // Counts of the photo block only (E4-2a): no file names, no titles.
          photos_created: photos.created ?? 0,
          photos_updated: photos.updated ?? 0,
          photos_removed: photos.removed ?? 0,
          photos_kept_manual: (photos.kept_manual_edit ?? 0) + (photos.kept_manual_delete ?? 0),
          photos_skipped_unknown_license: photos.skipped_unknown_license ?? 0,
          // Only a count, no region codes; absent when no collection changed (as before).
          ...(extraRegionsUpdated > 0 ? { extra_regions_updated: extraRegionsUpdated } : {}),
          // D-68: counts of the publication results only (no keys, no titles).
          ...(batch.publish === true ? { publication_results: publications } : {}),
        },
      };
    }
    case "removed": {
      const collections: Record<string, number> = {};
      const places: Record<string, number> = {};

      for (const report of outcome.reports) {
        count(report.kind === "collection" ? collections : places, report.result);
      }

      return {
        outcome: "applied",
        code: null,
        details: { ...base, collection_results: collections, place_results: places },
      };
    }
    case "refused":
      return {
        outcome: "rejected",
        code: "import_refused",
        details: { ...base, refusal: outcome.code },
      };
    case "rejected":
      return {
        outcome: "rejected",
        code: "import_refused",
        details: { ...base, refusal: outcome.code, count: outcome.count },
      };
    case "preview":
      // A preview writes nothing and has no audit entry; reaching this is a bug.
      throw new Error("A preview has no audit entry");
  }
}

/** The result entry of a load that threw: only the SQLSTATE class, never a message. */
export function resultOfFailure(
  batch: ImportAuditBatch,
  startEntryId: string,
  error: unknown,
): ImportAuditResult {
  const code = (error as { code?: unknown } | null)?.code;
  const sqlState = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;

  return {
    outcome: "rejected",
    code: "import_failed",
    details: {
      ...finishBase(batch, startEntryId),
      ...(sqlState === undefined ? {} : { sqlstate_class: sqlState.slice(0, 2) }),
    },
  };
}
