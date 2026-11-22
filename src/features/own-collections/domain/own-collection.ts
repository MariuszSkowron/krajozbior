import {
  COLLECTION_SUMMARY_MAX_LENGTH,
  COLLECTION_TITLE_MAX_LENGTH,
  REGIONS,
  REGION_LABELS,
  normalizeLineBreaks,
  type Region,
} from "@/features/catalog/domain/collection";

// Rules of an own collection that need no database (E8-S1). The region is one of the 16
// voivodeships or "polska" (D-34); the frozen copy of this list is the CHECK of the migration
// `own_collections`, and tests/integration/own-collections-access.test.ts compares them.

export const OWN_REGION_NATIONWIDE = "polska";
export const OWN_REGIONS = [...REGIONS, OWN_REGION_NATIONWIDE] as const;

export type OwnRegion = Region | typeof OWN_REGION_NATIONWIDE;

export const OWN_REGION_LABELS: Readonly<Record<OwnRegion, string>> = {
  ...REGION_LABELS,
  polska: "Cała Polska",
};

export function isOwnRegion(value: unknown): value is OwnRegion {
  return typeof value === "string" && (OWN_REGIONS as readonly string[]).includes(value);
}

export type OwnCollectionField = "title" | "summary" | "region";

export type OwnCollectionInput = Readonly<{
  title: string;
  summary: string;
  region: OwnRegion;
}>;

export type OwnCollectionValidation =
  | Readonly<{ ok: true; value: OwnCollectionInput }>
  | Readonly<{ ok: false; errors: readonly OwnCollectionField[] }>;

// Validates the whole form; `summary` is optional and defaults to an empty text. Line breaks are
// normalized before the length is counted; PostgreSQL cannot store a NUL character.
export function validateOwnCollectionInput(input: {
  title?: unknown;
  summary?: unknown;
  region?: unknown;
}): OwnCollectionValidation {
  const errors: OwnCollectionField[] = [];
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const summary =
    input.summary === undefined
      ? ""
      : typeof input.summary === "string"
        ? normalizeLineBreaks(input.summary).trim()
        : null;

  if (title.length < 1 || title.length > COLLECTION_TITLE_MAX_LENGTH || title.includes("\u0000")) {
    errors.push("title");
  }

  if (
    summary === null ||
    summary.length > COLLECTION_SUMMARY_MAX_LENGTH ||
    summary.includes("\u0000")
  ) {
    errors.push("summary");
  }

  if (!isOwnRegion(input.region)) {
    errors.push("region");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { title, summary: summary as string, region: input.region as OwnRegion },
  };
}
