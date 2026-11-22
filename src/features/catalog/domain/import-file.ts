// Validator of the collection import file (NDJSON, one JSON object per line).
// Pure: no database, no file access. The loader (a later step) takes the
// result and writes it; this module only decides whether the file is
// acceptable and in what normalized shape.
//
// Error values never contain text from the file: an error is a line number, a
// field path and a short code. Everything under `notes` is reported as the
// bare path `notes`, so neither its keys nor its values can reach a log.

import { z } from "zod";

import { isRegion, validateCollectionInput } from "@/features/catalog/domain/collection";
import type { Region } from "@/features/catalog/domain/collection";
import { PLACE_ACCESS_MAX_LENGTH, validatePlaceInput } from "@/features/catalog/domain/place";
import type { PlaceField, PlaceInput } from "@/features/catalog/domain/place";
import {
  normalizeCommonsLicense,
  type NormalizedLicense,
} from "@/features/catalog/domain/commons-license";
import {
  ATTRIBUTION_MAX_LENGTH,
  composeAttribution,
} from "@/features/catalog/domain/place-sources";

export const IMPORT_SCHEMA_ID = "krajozbior.curation/1";

// The one place that fixes the shape of an import key. The database holds the
// same general pattern; if the owner decides on a stricter one, only this
// constant (and the migration check) changes.
export const IMPORT_KEY_PATTERN = /^[a-z]{1,8}:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const COLLECTION_KEY_PREFIX = "col:";

export const SOURCE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
export const NOTES_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export const MAX_PLACES_IN_FILE_COLLECTION = 200;
export const MAX_SOURCE_REFS = 10;
export const MAX_NOTES_KEYS = 30;
export const MAX_NOTES_TEXT_LENGTH = 200;
export const MAX_NOTES_LIST_LENGTH = 20;
export const MAX_FLAGS = 20;

// Rectangle around Poland (degrees).
export const POLAND_BOUNDS = { latMin: 49.0, latMax: 54.9, lonMin: 14.1, lonMax: 24.2 } as const;

// Allowed hosts of the links inside a place record.
export const ALLOWED_HOSTS = {
  article: ["pl.wikipedia.org"],
  imageFile: ["upload.wikimedia.org"],
  imagePage: ["commons.wikimedia.org"],
  license: ["creativecommons.org"],
} as const;

export type ImportProfile = "full" | "public";

export type ImportFileError = Readonly<{
  /** 1-based line of the file, or null when the error concerns the file as a whole. */
  line: number | null;
  path: string;
  code: string;
}>;

// --- schemas -----------------------------------------------------------

function isHttpsUrl(value: string, hosts?: readonly string[]): boolean {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    (hosts === undefined || hosts.includes(url.hostname))
  );
}

function httpsUrl(hosts?: readonly string[]) {
  return z
    .string()
    .max(500)
    .refine((value) => isHttpsUrl(value, hosts), { message: "bad_url" });
}

const text = (max: number) => z.string().min(1).max(max);
const optionalText = (max: number) => z.string().max(max).nullish();
const sourceKey = z.string().regex(SOURCE_KEY_PATTERN);
const importKey = z.string().regex(IMPORT_KEY_PATTERN);
const isoDateTime = z.iso.datetime();

const batchSchema = z.strictObject({
  type: z.literal("batch"),
  schema: z.literal(IMPORT_SCHEMA_ID),
  batch_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/),
  created_at: isoDateTime,
  sources: z
    .array(
      z.strictObject({
        key: sourceKey,
        label: text(200),
        license: text(60),
        license_url: httpsUrl(ALLOWED_HOSTS.license),
        url: httpsUrl().nullish(),
        data_date: z.iso.date().nullish(),
      }),
    )
    .min(1)
    .max(50),
});

const collectionSchema = z.strictObject({
  type: z.literal("collection"),
  import_key: importKey.refine((value) => value.startsWith(COLLECTION_KEY_PREFIX), {
    message: "bad_collection_key",
  }),
  title: z.string(),
  summary: z.string(),
  region: z.string(),
  places: z.array(importKey).min(1).max(MAX_PLACES_IN_FILE_COLLECTION),
  publish: z.boolean().optional(),
  review: z.strictObject({ status: z.literal("approved") }),
});

const imageSchema = z.strictObject({
  commons_file: text(300),
  title: text(300),
  file_url: httpsUrl(ALLOWED_HOSTS.imageFile),
  page_url: httpsUrl(ALLOWED_HOSTS.imagePage),
  width: z.number().int().min(1).max(100000),
  height: z.number().int().min(1).max(100000),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  author_text: text(300),
  author_url: httpsUrl().nullish(),
  license_short: text(60),
  license_url: httpsUrl(ALLOWED_HOSTS.license),
  attribution_required: z.boolean(),
  credit_line: text(500),
  retrieved_at: isoDateTime,
});

const noteValue = z.union([
  z.string().max(MAX_NOTES_TEXT_LENGTH),
  z.array(z.string().max(MAX_NOTES_TEXT_LENGTH)).max(MAX_NOTES_LIST_LENGTH),
]);

// Auxiliary data for the reviewer. The loader neither reads nor stores it.
const notesSchema = z
  .record(z.string().regex(NOTES_KEY_PATTERN), noteValue)
  .refine((value) => Object.keys(value).length <= MAX_NOTES_KEYS, { message: "too_many" });

function placeSchema(profile: ImportProfile) {
  const full = profile === "full";
  const reviewShape = { status: z.enum(["approved", "approved_in_collection"]) };

  return z.strictObject({
    type: z.literal("place"),
    import_key: importKey.refine((value) => !value.startsWith(COLLECTION_KEY_PREFIX), {
      message: "bad_place_key",
    }),
    name: z.string(),
    location: z.strictObject({
      lat: z.number(),
      lon: z.number(),
      visit_radius_m: z.number(),
    }),
    admin: z.strictObject({
      region: z.string(),
      powiat: optionalText(100),
      gmina: optionalText(100),
      locality: optionalText(100),
    }),
    address: z.string(),
    description: z.strictObject({
      text: z.string(),
      method: z.enum(["template", "curator"]),
      sources: z.array(sourceKey).max(20),
    }),
    // The same condition as the `CHECK` of `place_sources.wikipedia_url`: an article address.
    wikipedia_pl: httpsUrl(ALLOWED_HOSTS.article)
      .refine((value) => value.startsWith("https://pl.wikipedia.org/wiki/"), {
        message: "bad_url",
      })
      .nullish(),
    access: z.strictObject({
      note: optionalText(PLACE_ACCESS_MAX_LENGTH),
      warning: optionalText(PLACE_ACCESS_MAX_LENGTH),
    }),
    attribution: z.array(sourceKey).max(20),
    retrieved_at: isoDateTime,
    review: full
      ? z.strictObject({
          ...reviewShape,
          flags: z.array(z.string().max(200)).max(MAX_FLAGS).optional(),
        })
      : z.strictObject(reviewShape),
    // Zdjęcie z Commons jest też w profilu `public` (E4-2a, Q13 A).
    image: imageSchema.nullish(),
    ...(full
      ? {
          source_refs: z
            .array(
              z.strictObject({
                source: sourceKey,
                ref: z
                  .string()
                  .min(1)
                  .max(80)
                  .refine((value) => value === value.trim(), { message: "bad_ref" }),
              }),
            )
            .max(MAX_SOURCE_REFS)
            .optional(),
          notes: notesSchema.optional(),
        }
      : {}),
  });
}

const placeSchemas = { full: placeSchema("full"), public: placeSchema("public") };

// --- results -----------------------------------------------------------

export type ImportSource = Readonly<{
  key: string;
  label: string;
  license: string;
  licenseUrl: string;
  url: string | null;
  dataDate: string | null;
}>;

export type ImportBatch = Readonly<{
  batchId: string;
  createdAt: string;
  sources: readonly ImportSource[];
}>;

export type ImportCollection = Readonly<{
  line: number;
  importKey: string;
  title: string;
  summary: string;
  region: Region;
  placeKeys: readonly string[];
  publish: boolean;
}>;

/** Zdjęcie z Commons, jak je loader zapisuje (bez adresu pliku: adres buduje `photos:fetch`). */
export type ImportImage = Readonly<{
  commonsFile: string;
  title: string;
  pageUrl: string;
  authorText: string;
  authorUrl: string | null;
  /** Szerokość oryginału w pikselach (wybór miniatury przy pobieraniu). */
  sourceWidth: number;
  license: NormalizedLicense;
  retrievedAt: string;
}>;

export type ImportPlace = Readonly<{
  line: number;
  importKey: string;
  input: PlaceInput;
  region: Region;
  powiat: string | null;
  gmina: string | null;
  locality: string | null;
  descriptionMethod: "template" | "curator";
  descriptionSources: readonly string[];
  attribution: readonly string[];
  wikipediaUrl: string | null;
  retrievedAt: string;
  reviewStatus: "approved" | "approved_in_collection";
  /** Zdjęcie z poprawną licencją; `null`, gdy brak bloku albo licencji nie da się przyjąć. */
  image: ImportImage | null;
  /** Blok `image` jest, ale licencja spoza listy (wynik `skipped_unknown_license`). */
  imageSkipped: boolean;
}>;

export type ImportFileResult =
  | Readonly<{
      ok: true;
      batch: ImportBatch;
      collections: readonly ImportCollection[];
      places: readonly ImportPlace[];
      /** Keys listed in a collection that have no place record in the file (to check in the database). */
      externalKeys: readonly string[];
    }>
  | Readonly<{ ok: false; errors: readonly ImportFileError[] }>;

// --- helpers -----------------------------------------------------------

/** `access.note`, an empty line, `access.warning`; empty parts are left out. */
export function composeAccessInfo(
  note: string | null | undefined,
  warning: string | null | undefined,
): string {
  return [note, warning]
    .map((part) => (part ?? "").replace(/\r\n?/g, "\n").trim())
    .filter((part) => part !== "")
    .join("\n\n");
}

function pathToString(path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (result, part) =>
      typeof part === "number"
        ? `${result}[${part}]`
        : result === ""
          ? String(part)
          : `${result}.${String(part)}`,
    "",
  );
}

// The parent of a failing field always exists (the schema stops at the first
// missing object), so the walk needs no guards.
function isPresent(root: unknown, path: readonly PropertyKey[]): boolean {
  const value = path.reduce<unknown>(
    (current, part) => (current as Record<PropertyKey, unknown>)[part],
    root,
  );

  return value !== undefined;
}

function zodCode(issue: z.core.$ZodIssue, root: unknown): string {
  switch (issue.code) {
    case "unrecognized_keys":
      return "unknown_field";
    case "invalid_type":
      return isPresent(root, issue.path) ? "wrong_type" : "required";
    case "too_big":
    case "too_small":
      return "length_or_range";
    case "invalid_format":
      return "bad_format";
    case "invalid_value":
      return "bad_value";
    case "custom":
      return issue.message;
    default:
      return "invalid";
  }
}

// NUL, "<", DEL, C1 controls (U+0080–U+009F) and text direction characters
// (U+202A–U+202E, U+2066–U+2069) never belong in a title or a text.
const FORBIDDEN_CHARACTER = /[\u0000<\u007f-\u009f‪-‮⁦-⁩]/;

function hasForbiddenCharacter(value: unknown): boolean {
  if (typeof value === "string") {
    return FORBIDDEN_CHARACTER.test(value);
  }

  if (Array.isArray(value)) {
    return value.some(hasForbiddenCharacter);
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(
      ([key, item]) => hasForbiddenCharacter(key) || hasForbiddenCharacter(item),
    );
  }

  return false;
}

const PLACE_FIELD_PATHS: Readonly<Record<PlaceField, string>> = {
  name: "name",
  description: "description.text",
  address: "address",
  accessInfo: "access",
  latitude: "location.lat",
  longitude: "location.lon",
  visitRadiusM: "location.visit_radius_m",
};

// --- the validator -----------------------------------------------------

type Raw = Record<string, unknown>;
// The public profile is a subset of the full one, so one record type serves both.
type PlaceRecord = z.infer<ReturnType<typeof placeSchema>> & {
  review: { flags?: string[] };
  source_refs?: Array<{ source: string; ref: string }>;
};

/**
 * Validates the whole file. `profile` "public" refuses the fields that exist
 * only in the full profile; "full" accepts both.
 */
export function parseImportFile(
  content: string,
  options: Readonly<{ profile?: ImportProfile }> = {},
): ImportFileResult {
  const profile = options.profile ?? "full";
  const errors: ImportFileError[] = [];
  const seen = new Set<string>();
  const fail = (line: number | null, path: string, code: string) => {
    const id = `${line}|${path}|${code}`;

    if (!seen.has(id)) {
      seen.add(id);
      errors.push({ line, path, code });
    }
  };
  const failIssues = (line: number, issues: readonly z.core.$ZodIssue[], root: unknown) => {
    for (const issue of issues) {
      const inNotes = issue.path[0] === "notes";

      fail(line, inNotes ? "notes" : pathToString(issue.path), zodCode(issue, root));
    }
  };

  const state: { batch: ImportBatch | null } = { batch: null };
  let batchSeen = false;
  const inputs = new Map<PlaceRecord, PlaceInput>();
  const collections: ImportCollection[] = [];
  const places: ImportPlace[] = [];
  const placeRecords: Array<{ line: number; record: PlaceRecord }> = [];

  const lines = content.replace(/^﻿/, "").split("\n");

  lines.forEach((rawLine, index) => {
    const line = index + 1;
    const source = rawLine.trim();

    if (source === "") {
      return;
    }

    let value: unknown;

    try {
      value = JSON.parse(source);
    } catch {
      fail(line, "", "invalid_json");

      return;
    }

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      fail(line, "", "not_an_object");

      return;
    }

    if (hasForbiddenCharacter(value)) {
      // The path is not known without walking again; the record is refused as a whole.
      fail(line, "", "forbidden_character");

      return;
    }

    const type = (value as Raw).type;

    if (type === "batch") {
      if (batchSeen) {
        fail(line, "type", "duplicate_batch");

        return;
      }

      batchSeen = true;

      if (collections.length > 0 || placeRecords.length > 0) {
        fail(line, "type", "batch_not_first");
      }

      const parsed = batchSchema.safeParse(value);

      if (!parsed.success) {
        failIssues(line, parsed.error.issues, value);

        return;
      }

      const keys = new Set<string>();

      parsed.data.sources.forEach((item, position) => {
        if (keys.has(item.key)) {
          fail(line, `sources[${position}].key`, "duplicate_source");
        }

        keys.add(item.key);
      });
      state.batch = {
        batchId: parsed.data.batch_id,
        createdAt: parsed.data.created_at,
        sources: parsed.data.sources.map((item) => ({
          key: item.key,
          label: item.label,
          license: item.license,
          licenseUrl: item.license_url,
          url: item.url ?? null,
          dataDate: item.data_date ?? null,
        })),
      };

      return;
    }

    if (!batchSeen) {
      fail(line, "type", "batch_not_first");
    }

    if (type === "collection") {
      if (placeRecords.length > 0) {
        fail(line, "type", "collection_after_place");
      }

      const parsed = collectionSchema.safeParse(value);

      if (!parsed.success) {
        failIssues(line, parsed.error.issues, value);

        return;
      }

      const checked = validateCollectionInput(parsed.data);

      if (!checked.ok) {
        checked.errors.forEach((field) => fail(line, field, "bad_value"));

        return;
      }

      collections.push({
        line,
        importKey: parsed.data.import_key,
        title: checked.value.title,
        summary: checked.value.summary,
        region: checked.value.region,
        placeKeys: parsed.data.places,
        publish: parsed.data.publish ?? false,
      });

      return;
    }

    if (type === "place") {
      const parsed = placeSchemas[profile].safeParse(value);

      if (!parsed.success) {
        failIssues(line, parsed.error.issues, value);

        return;
      }

      // The public profile has no `flags` or `source_refs`; reading them gives undefined.
      placeRecords.push({ line, record: parsed.data as PlaceRecord });

      return;
    }

    fail(line, "type", "unknown_type");
  });

  if (!batchSeen) {
    fail(null, "", "missing_batch");
  }

  if (collections.length === 0) {
    fail(null, "", "no_collection");
  }

  const sourceKeys = new Set((state.batch?.sources ?? []).map((item) => item.key));
  const sourceLabels = new Map(
    (state.batch?.sources ?? []).map((item) => [item.key, item] as const),
  );
  const checkSource = (line: number, path: string, key: string) => {
    if (state.batch !== null && !sourceKeys.has(key)) {
      fail(line, path, "unknown_source");
    }
  };

  // Place records: domain limits, Poland, review rules, sources.
  for (const { line, record } of placeRecords) {
    const accessInfo = composeAccessInfo(record.access.note, record.access.warning);
    const checked = validatePlaceInput({
      name: record.name,
      description: record.description.text,
      address: record.address,
      accessInfo,
      latitude: record.location.lat,
      longitude: record.location.lon,
      visitRadiusM: record.location.visit_radius_m,
    });

    if (!checked.ok) {
      checked.errors.forEach((field) => fail(line, PLACE_FIELD_PATHS[field], "bad_value"));
    } else {
      const { latitude, longitude } = checked.value;

      inputs.set(record, checked.value);

      if (latitude < POLAND_BOUNDS.latMin || latitude > POLAND_BOUNDS.latMax) {
        fail(line, "location.lat", "outside_poland");
      }

      if (longitude < POLAND_BOUNDS.lonMin || longitude > POLAND_BOUNDS.lonMax) {
        fail(line, "location.lon", "outside_poland");
      }
    }

    if (!isRegion(record.admin.region)) {
      fail(line, "admin.region", "bad_value");
    }

    const flags = record.review.flags;

    if (flags !== undefined && flags.length > 0 && record.review.status !== "approved") {
      fail(line, "review.status", "flags_need_approved");
    }

    record.description.sources.forEach((key, position) =>
      checkSource(line, `description.sources[${position}]`, key),
    );
    record.attribution.forEach((key, position) =>
      checkSource(line, `attribution[${position}]`, key),
    );

    // The signature is kept in a column of 500 characters (`place_sources`).
    const signature = composeAttribution(record.attribution, sourceLabels);

    // A place without a source signature is refused: the licences (CC BY) require it.
    if (signature === null) {
      fail(line, "attribution", "missing_attribution");
    } else if (signature.length > ATTRIBUTION_MAX_LENGTH) {
      fail(line, "attribution", "length_or_range");
    }

    for (const [position, ref] of (record.source_refs ?? []).entries()) {
      checkSource(line, `source_refs[${position}].source`, ref.source);
    }
  }

  // Keys: unique per kind, collections list each place once.
  const collectionKeys = new Set<string>();

  for (const collection of collections) {
    if (collectionKeys.has(collection.importKey)) {
      fail(collection.line, "import_key", "duplicate_key");
    }

    collectionKeys.add(collection.importKey);

    if (new Set(collection.placeKeys).size !== collection.placeKeys.length) {
      fail(collection.line, "places", "duplicate_place");
    }
  }

  const placeKeys = new Set<string>();

  for (const { line, record } of placeRecords) {
    if (placeKeys.has(record.import_key)) {
      fail(line, "import_key", "duplicate_key");
    }

    placeKeys.add(record.import_key);
  }

  const referenced = new Set(collections.flatMap((collection) => collection.placeKeys));

  for (const { line, record } of placeRecords) {
    if (!referenced.has(record.import_key)) {
      fail(line, "import_key", "unreferenced_place");
    }
  }

  if (errors.length > 0 || state.batch === null) {
    return { ok: false, errors };
  }

  for (const { line, record } of placeRecords) {
    const image = record.image ?? null;
    const licence =
      image === null ? null : normalizeCommonsLicense(image.license_short, image.license_url);

    places.push({
      line,
      importKey: record.import_key,
      // Every record reached here without an error, so its input was stored above.
      input: inputs.get(record) as PlaceInput,
      region: record.admin.region as Region,
      powiat: record.admin.powiat ?? null,
      gmina: record.admin.gmina ?? null,
      locality: record.admin.locality ?? null,
      descriptionMethod: record.description.method,
      descriptionSources: record.description.sources,
      attribution: record.attribution,
      wikipediaUrl: record.wikipedia_pl ?? null,
      retrievedAt: record.retrieved_at,
      reviewStatus: record.review.status,
      image:
        image !== null && licence !== null && licence.ok
          ? {
              commonsFile: image.commons_file,
              title: image.title,
              pageUrl: image.page_url,
              authorText: image.author_text,
              authorUrl: image.author_url ?? null,
              sourceWidth: image.width,
              license: licence.license,
              retrievedAt: image.retrieved_at,
            }
          : null,
      imageSkipped: image !== null && licence !== null && !licence.ok,
    });
  }

  const externalKeys = [...referenced].filter((key) => !placeKeys.has(key)).sort();

  return { ok: true, batch: state.batch, collections, places, externalKeys };
}
