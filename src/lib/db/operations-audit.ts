// Operations and refusal codes the `operations_audit` CHECK constraints allow
// (Migration20261117130000_organizations_ops_audit, extended by
// Migration20261118120000_operations_audit_ops_role). An integration test
// compares these lists with the constraints of the migrated database.
//
// Every migration that adds operations recreates the constraints with the
// full list. A change merged later adds its own values here too, so a lost
// operation fails that test.

import { z } from "zod";

export const AUDIT_OPERATIONS = [
  "grant_curator",
  "revoke_curator",
  "set_organization_status",
  "set_user_role",
  // Written by the database only, as a result of deleting an account
  // (Migration20261118140000_account_deletion); `writeAuditEntry` cannot write it.
  "delete_account",
  // The loader `catalog:import --target server` (Migration20261121140000).
  "catalog_import",
  "catalog_remove",
  // The command `news:import` (E7-R, Migration20261122020000_news_posts); the caller
  // writes the entry in the transaction of `ops_put_news`, without `details`.
  "news_import",
] as const;

export type AuditOperation = (typeof AUDIT_OPERATIONS)[number];

/** What an operator command may write: everything except `delete_account`. */
export type OperatorAuditOperation = Exclude<AuditOperation, "delete_account">;

export const AUDIT_OUTCOMES = ["applied", "rejected"] as const;

export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const AUDIT_ERROR_CODES = [
  "user_not_found",
  "organization_not_found",
  "kind_mismatch",
  "person_member_limit",
  "organization_details_required",
  "import_refused",
  "import_failed",
  // Refusals of `ops_put_news` (Migration20261122020000_news_posts).
  "invalid_transition",
  "stale_link",
  "too_many_news",
] as const;

export type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[number];

// The reason and the operator label of every operator command, validated the
// same way everywhere (ops:curator, auth:create-admin). Control characters
// (Unicode Cc) are refused before trimming, like in the audit CHECKs: no line
// breaks or terminal escapes in the audit.
const auditText = (max: number) =>
  z
    .string()
    .regex(/^\P{Cc}*$/u)
    .trim()
    .min(1)
    .max(max);

export const AUDIT_REASON_MAX_LENGTH = 400;
export const AUDIT_OPERATOR_MAX_LENGTH = 80;
// The audit cannot be edited or deleted, so the reason carries no personal data (DB-8): an
// e-mail address (`@`) is refused; the subject of the operation is already its own column.
export const auditReasonSchema = auditText(AUDIT_REASON_MAX_LENGTH).refine(
  (reason) => !reason.includes("@"),
);
export const auditOperatorSchema = auditText(AUDIT_OPERATOR_MAX_LENGTH);

export type AuditQueryClient = Readonly<{
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}>;

export type AuditEntry = Readonly<{
  operation: OperatorAuditOperation;
  operator: string;
  reason: string;
  subjectUserId: string | null;
  organizationId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  outcome: AuditOutcome;
  code: AuditErrorCode | null;
  /** Batch details; only `catalog_import` and `catalog_remove` (a CHECK enforces it). */
  details?: Record<string, unknown> | null;
}>;

/**
 * Appends one entry on the caller's connection (krajozbior_ops, inside the
 * caller's transaction) and returns its id. The database fills `occurred_at`,
 * `recorded_by` and `transaction_id`; the role has no grant to set them.
 */
export async function writeAuditEntry(
  client: AuditQueryClient,
  entry: AuditEntry,
): Promise<string> {
  const details = entry.details ?? null;
  // The `details` column is named only when there are details, so the entries
  // of the other operations keep the exact statement they always had.
  const { rows } = await client.query(
    `insert into public.operations_audit
       (operation, operator_label, subject_user_id, organization_id, outcome,
        before_state, after_state, reason, error_code${details === null ? "" : ", details"})
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9${details === null ? "" : ", $10::jsonb"})
     returning id`,
    [
      entry.operation,
      entry.operator,
      entry.subjectUserId,
      entry.organizationId,
      entry.outcome,
      entry.before === null ? null : JSON.stringify(entry.before),
      entry.after === null ? null : JSON.stringify(entry.after),
      entry.reason,
      entry.code,
      ...(details === null ? [] : [JSON.stringify(details)]),
    ],
  );

  return rows[0]!.id as string;
}
