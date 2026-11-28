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

// The name is shown to everyone, so it is a closed set: Latin letters as explicit code ranges (not
// \p{Script=Latin}, which lets full-width letters through; PostgreSQL has no \p{...} either),
// digits, a space and . , : ; ! ? ' single and double quotes of every common kind (also « »),
// ( ) & / + en and em dash and hyphen. No invisible, formatting or control character (Cc, Cf) and no letter of another
// script (C-05 of the audit). The migration `curator_applications` keeps a frozen copy of this set.
export const ORGANIZATION_NAME_PATTERN =
  /^[A-Za-z0-9\u{C0}-\u{D6}\u{D8}-\u{F6}\u{F8}-\u{1BF}\u{1C4}-\u{24F}\u{1E00}-\u{1EFF} .,:;!?'\u{2018}\u{2019}\u{201A}"\u{201C}\u{201E}\u{201D}()&/+\u{2013}\u{2014}\u{AB}\u{BB}-]+$/u;

export const ORGANIZATION_NAME_EMPTY_MESSAGE = "Podaj nazwę organizacji.";

export const ORGANIZATION_NAME_TOO_LONG_MESSAGE = "Nazwa może mieć najwyżej 120 znaków.";

export const ORGANIZATION_NAME_MESSAGE =
  "Nazwa może zawierać litery alfabetu łacińskiego (także z akcentami), cyfry, spacje i znaki interpunkcyjne. Usuń emotki i znaki specjalne.";

/** The same text with every run of spaces folded to one (two look-alike names are one name). */
export function collapseSpaces(value: string): string {
  return value.replace(/ {2,}/g, " ");
}

/** Why a normalized name (NFC, trimmed, spaces folded) is refused: the message, or null when it passes. */
export function organizationNameProblem(name: string): string | null {
  if (name.length === 0) {
    return ORGANIZATION_NAME_EMPTY_MESSAGE;
  }

  if (name.length > ORGANIZATION_NAME_MAX_LENGTH) {
    return ORGANIZATION_NAME_TOO_LONG_MESSAGE;
  }

  return ORGANIZATION_NAME_PATTERN.test(name) ? null : ORGANIZATION_NAME_MESSAGE;
}

/** NFC-normalized, trimmed name of 1-120 allowed characters, or null when it does not qualify. */
export function normalizeOrganizationName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const name = collapseSpaces(value.normalize("NFC").trim());

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
