// Organization rules that need no database (E1). Frozen copies of the lists
// live in the migration CHECKs; tests/integration/organizations-access.test.ts
// compares them with these constants.

export const ORGANIZATION_KINDS = [
  "municipality",
  "pttk",
  "local_tourism_org",
  "regional_tourism_org",
  "person",
  "other",
] as const;

export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const ORGANIZATION_STATUSES = ["approved", "suspended"] as const;

export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export function isOrganizationKind(value: unknown): value is OrganizationKind {
  return typeof value === "string" && (ORGANIZATION_KINDS as readonly string[]).includes(value);
}

export const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const ORGANIZATION_SLUG_MAX_LENGTH = 60;
export const ORGANIZATION_NAME_MAX_LENGTH = 120;

export function isOrganizationSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= ORGANIZATION_SLUG_MAX_LENGTH &&
    ORGANIZATION_SLUG_PATTERN.test(value)
  );
}

/** Trimmed name of 1-120 characters, or null when it does not qualify. */
export function normalizeOrganizationName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const name = value.trim();

  return name.length >= 1 && name.length <= ORGANIZATION_NAME_MAX_LENGTH ? name : null;
}

/** A person (kind `person`) has at most one member; other kinds have no limit. */
export function canAddMember(kind: OrganizationKind, currentMembers: number): boolean {
  return kind !== "person" || currentMembers < 1;
}
