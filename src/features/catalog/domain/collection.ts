// Collection rules that need no database (E1). Frozen copies of the lists live
// in the migration CHECKs; tests/integration/catalog-access.test.ts compares
// them with these constants.

export const REGIONS = [
  "dolnoslaskie",
  "kujawsko_pomorskie",
  "lubelskie",
  "lubuskie",
  "lodzkie",
  "malopolskie",
  "mazowieckie",
  "opolskie",
  "podkarpackie",
  "podlaskie",
  "pomorskie",
  "slaskie",
  "swietokrzyskie",
  "warminsko_mazurskie",
  "wielkopolskie",
  "zachodniopomorskie",
] as const;

export type Region = (typeof REGIONS)[number];

export const COLLECTION_STATUSES = ["draft", "published"] as const;

export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export const COLLECTION_TITLE_MAX_LENGTH = 120;
export const COLLECTION_SUMMARY_MAX_LENGTH = 280;

export function isRegion(value: unknown): value is Region {
  return typeof value === "string" && (REGIONS as readonly string[]).includes(value);
}

/** CRLF and lone CR become LF, so a form's line breaks count once. */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export type CollectionField = "title" | "summary" | "region";

export type CollectionInput = Readonly<{ title: string; summary: string; region: Region }>;

export type CollectionValidation =
  | Readonly<{ ok: true; value: CollectionInput }>
  | Readonly<{ ok: false; errors: readonly CollectionField[] }>;

// Validates the whole collection form; `summary` is optional and defaults to
// an empty text. Line breaks are normalized before the length is counted.
export function validateCollectionInput(input: {
  title?: unknown;
  summary?: unknown;
  region?: unknown;
}): CollectionValidation {
  const errors: CollectionField[] = [];
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const summary =
    input.summary === undefined
      ? ""
      : typeof input.summary === "string"
        ? normalizeLineBreaks(input.summary).trim()
        : null;

  if (title.length < 1 || title.length > COLLECTION_TITLE_MAX_LENGTH) {
    errors.push("title");
  }

  if (summary === null || summary.length > COLLECTION_SUMMARY_MAX_LENGTH) {
    errors.push("summary");
  }

  if (!isRegion(input.region)) {
    errors.push("region");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { title, summary: summary as string, region: input.region as Region },
  };
}
