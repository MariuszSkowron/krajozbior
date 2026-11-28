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

// Polish names of the voivodeships for screens (the stored value is the key).
export const REGION_LABELS: Readonly<Record<Region, string>> = {
  dolnoslaskie: "Dolnośląskie",
  kujawsko_pomorskie: "Kujawsko-pomorskie",
  lubelskie: "Lubelskie",
  lubuskie: "Lubuskie",
  lodzkie: "Łódzkie",
  malopolskie: "Małopolskie",
  mazowieckie: "Mazowieckie",
  opolskie: "Opolskie",
  podkarpackie: "Podkarpackie",
  podlaskie: "Podlaskie",
  pomorskie: "Pomorskie",
  slaskie: "Śląskie",
  swietokrzyskie: "Świętokrzyskie",
  warminsko_mazurskie: "Warmińsko-mazurskie",
  wielkopolskie: "Wielkopolskie",
  zachodniopomorskie: "Zachodniopomorskie",
};

export const COLLECTION_STATUSES = ["draft", "published"] as const;

export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

// Polish names of the states shown to a curator (the panel never shows the key).
export const COLLECTION_STATUS_LABELS: Readonly<Record<CollectionStatus, string>> = {
  draft: "Szkic",
  published: "Opublikowana",
};

// Two layers of the catalog: a land (`land`, e.g. "Warmia") and a smaller collection with one
// theme or story (`theme`). A frozen copy of the list lives in the migration CHECK.
export const COLLECTION_KINDS = ["land", "theme"] as const;

export type CollectionKind = (typeof COLLECTION_KINDS)[number];

export function isCollectionKind(value: unknown): value is CollectionKind {
  return typeof value === "string" && (COLLECTION_KINDS as readonly string[]).includes(value);
}

/** A land that shares places with a theme collection; `sharedPlaces` counts the common ones. */
export type LandOfCollection = Readonly<{ slug: string; title: string; sharedPlaces: number }>;

export type LandLine =
  | Readonly<{ kind: "part_of"; land: LandOfCollection }>
  | Readonly<{ kind: "spread"; lands: readonly LandOfCollection[] }>;

/**
 * Which line the page of a theme collection shows under the description. `lands` come ordered
 * by the number of shared places. "Part of a land" only when every place of the collection lies
 * in that one land; otherwise the lands are listed (one common place of a dozen is no "part").
 * No lands (or no places): no line.
 *
 * Every place belongs to exactly one land, so the shared places of different lands never
 * overlap: when one land holds all `placeCount` places there is no other land in `lands`.
 * The `lands.length === 1` condition is therefore equivalent to the specification's
 * `sharedPlaces === placeCount`; it only states the same thing explicitly.
 */
export function landLine(placeCount: number, lands: readonly LandOfCollection[]): LandLine | null {
  const [first] = lands;

  if (first === undefined) {
    return null;
  }

  if (lands.length === 1 && placeCount > 0 && first.sharedPlaces === placeCount) {
    return { kind: "part_of", land: first };
  }

  return { kind: "spread", lands };
}

export const COLLECTION_TITLE_MAX_LENGTH = 120;
export const COLLECTION_SUMMARY_MAX_LENGTH = 280;

export function isRegion(value: unknown): value is Region {
  return typeof value === "string" && (REGIONS as readonly string[]).includes(value);
}

// A collection has one main voivodeship (`region`) and 0-3 extra ones (`extra_regions`).
export const MAX_EXTRA_REGIONS = 3;

export type ExtraRegionsError = "bad_value" | "duplicate" | "same_as_region" | "too_many";

export type ExtraRegionsValidation =
  | Readonly<{ ok: true; value: readonly Region[] }>
  | Readonly<{
      ok: false;
      errors: readonly Readonly<{ code: ExtraRegionsError; index: number | null }>[];
    }>;

// Validates the extra voivodeships of a collection: every element is a known code,
// no repeats, none equal to the main one, at most MAX_EXTRA_REGIONS. The result is in
// the order of REGIONS. `index` points at the element (null for the whole list).
export function normalizeExtraRegions(
  primary: Region,
  raw: readonly unknown[],
): ExtraRegionsValidation {
  const errors: { code: ExtraRegionsError; index: number | null }[] = [];
  const seen = new Set<Region>();

  raw.forEach((item, index) => {
    if (!isRegion(item)) {
      errors.push({ code: "bad_value", index });

      return;
    }

    if (item === primary) {
      errors.push({ code: "same_as_region", index });
    } else if (seen.has(item)) {
      errors.push({ code: "duplicate", index });
    }

    seen.add(item);
  });

  if (seen.size > MAX_EXTRA_REGIONS) {
    errors.push({ code: "too_many", index: null });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: REGIONS.filter((region) => seen.has(region)) };
}

/** Main voivodeship first, then the extra ones (already in the order of REGIONS). */
export function regionsOf(collection: {
  region: Region;
  extraRegions: readonly Region[];
}): readonly Region[] {
  return [collection.region, ...collection.extraRegions];
}

/** Label for a card or a heading: "Dolnośląskie · Opolskie". */
export function regionsLabelOf(collection: {
  region: Region;
  extraRegions: readonly Region[];
}): string {
  return regionsOf(collection)
    .map((region) => REGION_LABELS[region])
    .join(" · ");
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

  // PostgreSQL cannot store a NUL character: reject it as invalid input.
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
