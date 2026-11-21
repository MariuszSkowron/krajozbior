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
}>;

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

      for (const collection of outcome.collections) {
        count(collections, collection.result);

        for (const place of collection.places) {
          count(places, place.result);
        }
      }

      return {
        outcome: "applied",
        code: null,
        details: { ...base, collection_results: collections, place_results: places },
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
