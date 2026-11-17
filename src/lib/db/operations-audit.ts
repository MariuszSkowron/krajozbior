// Operations and refusal codes the `operations_audit` CHECK constraints allow
// (Migration20261117130000_organizations_ops_audit). An integration test
// compares these lists with the constraints of the migrated database.
//
// Every migration that adds operations recreates the constraints with the
// full list. A change merged later adds its own values here too, so a lost
// operation fails that test.

export const AUDIT_OPERATIONS = [
  "grant_curator",
  "revoke_curator",
  "set_organization_status",
] as const;

export type AuditOperation = (typeof AUDIT_OPERATIONS)[number];

export const AUDIT_OUTCOMES = ["applied", "rejected"] as const;

export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const AUDIT_ERROR_CODES = [
  "user_not_found",
  "organization_not_found",
  "kind_mismatch",
  "person_member_limit",
  "organization_details_required",
] as const;

export type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[number];
