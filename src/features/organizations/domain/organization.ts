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

// The name is shown to everyone, so it is a closed set: Latin letters with Polish marks, digits,
// a space and . , - ' ( ) &. No invisible, formatting or control character (Cc, Cf: zero-width,
// right-to-left override, tags) and no letter of another script that looks like a Latin one
// (C-05 of the audit). The migration `curator_applications` keeps a frozen copy of this set.
export const ORGANIZATION_NAME_PATTERN = /^[A-Za-z0-9ĄąĆćĘęŁłŃńÓóŚśŹźŻż .,'()&-]+$/;

export const ORGANIZATION_NAME_MESSAGE =
  "Nazwa może zawierać litery, cyfry, spacje i znaki . , - ' ( ) &.";

/** NFC-normalized, trimmed name of 1-120 allowed characters, or null when it does not qualify. */
export function normalizeOrganizationName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const name = value.normalize("NFC").trim();

  return name.length >= 1 &&
    name.length <= ORGANIZATION_NAME_MAX_LENGTH &&
    ORGANIZATION_NAME_PATTERN.test(name)
    ? name
    : null;
}

/** A person (kind `person`) has at most one member; other kinds have no limit. */
export function canAddMember(kind: OrganizationKind, currentMembers: number): boolean {
  return kind !== "person" || currentMembers < 1;
}
