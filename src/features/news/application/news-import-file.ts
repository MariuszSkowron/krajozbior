import { isUuid } from "@/features/catalog/domain/uuid";

import { MAX_NEWS_PER_ORGANIZATION } from "../domain/limits";
import { validateNewsInput, type NewsInput } from "../domain/news-input";

// The file of the editorial news (E7-R2a, spec E7 section 14.4): NDJSON, one news item
// in its target state per line. Pure: no file access, no database. Every line goes
// through the strict validation of the domain (a typo in a field name is refused, not
// dropped) and its body through the link policy of `parseNewsBody`.
//
// Errors carry the number of the line, the field and the fixed Polish message of the
// domain; never a piece of the text of the file (the unknown field is named by the key,
// cut to 40 characters by the domain).

export const NEWS_IMPORT_STATUSES = ["draft", "published", "withdrawn"] as const;

export type NewsImportStatus = (typeof NEWS_IMPORT_STATUSES)[number];

/** One validated line of the file. */
export type NewsImportEntry = Readonly<{
  /** 1-based line of the file. */
  line: number;
  id: string;
  status: NewsImportStatus;
  input: NewsInput;
}>;

export type NewsImportFileError = Readonly<{
  /** 1-based line; 0 when the error concerns the whole file. */
  line: number;
  field: string;
  message: string;
}>;

export type NewsImportParse =
  | Readonly<{ ok: true; entries: readonly NewsImportEntry[] }>
  | Readonly<{ ok: false; errors: readonly NewsImportFileError[] }>;

const FILE_KEYS: readonly string[] = [
  "id",
  "kind",
  "title",
  "lead",
  "body",
  "collection_id",
  "collection_slug",
  "place_id",
  "event_starts_on",
  "event_ends_on",
  "status",
];

/** The limit of the size of the file; the deployment script checks the same number. */
export const MAX_NEWS_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

const fileError = (message: string): NewsImportParse => ({
  ok: false,
  errors: [{ line: 0, field: "file", message }],
});

function parseLine(
  raw: string,
  line: number,
): Readonly<{ entry: NewsImportEntry } | { errors: NewsImportFileError[] }> {
  const fail = (field: string, message: string) => ({ errors: [{ line, field, message }] });
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return fail("form", "Linia nie jest poprawnym JSON.");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("form", "Linia ma być obiektem JSON.");
  }

  const object = value as Record<string, unknown>;
  const errors: NewsImportFileError[] = Object.keys(object)
    .filter((key) => !FILE_KEYS.includes(key))
    .map((key) => ({
      line,
      field: "form",
      message: `Nieznane pole: „${key.slice(0, 40).replace(/[^\p{L}\p{N}_-]/gu, "?")}”.`,
    }));

  if (errors.length > 0) {
    return { errors };
  }

  if (typeof object.id !== "string" || !isUuid(object.id)) {
    errors.push({ line, field: "id", message: "Podaj identyfikator wpisu (UUID)." });
  }

  const status = object.status;

  if (typeof status !== "string" || !(NEWS_IMPORT_STATUSES as readonly string[]).includes(status)) {
    errors.push({
      line,
      field: "status",
      message: "Stan ma być jednym z: draft, published, withdrawn.",
    });
  }

  // A collection is named by its identifier: the command reads no catalog table, so it
  // cannot turn an address (`collection_slug`) into an identifier.
  if (object.collection_slug !== undefined && object.collection_slug !== null) {
    errors.push({
      line,
      field: "collection_slug",
      message: "Pole collection_slug nie jest obsługiwane; podaj collection_id (UUID kolekcji).",
    });
  }

  const validation = validateNewsInput(
    {
      kind: object.kind,
      title: object.title,
      lead: object.lead,
      body: object.body,
      collectionId: object.collection_id,
      placeId: object.place_id,
      eventStartsOn: object.event_starts_on,
      eventEndsOn: object.event_ends_on,
    },
    { strict: true },
  );

  if (!validation.ok) {
    errors.push(
      ...validation.errors.map(({ field, message }) => ({ line, field: field as string, message })),
    );
  }

  if (errors.length > 0 || !validation.ok) {
    return { errors };
  }

  return {
    entry: {
      line,
      id: (object.id as string).toLowerCase(),
      status: status as NewsImportStatus,
      input: validation.value,
    },
  };
}

/** Validates the whole file; every bad line is reported, so one run lists all the slips. */
export function parseNewsImportFile(content: string): NewsImportParse {
  if (Buffer.byteLength(content, "utf8") > MAX_NEWS_IMPORT_FILE_BYTES) {
    return fileError("Plik jest większy niż dozwolone 2 MiB.");
  }

  const entries: NewsImportEntry[] = [];
  const errors: NewsImportFileError[] = [];
  const seen = new Set<string>();

  content.split("\n").forEach((rawLine, index) => {
    const text = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (text.trim() === "") {
      return;
    }

    const parsed = parseLine(text, index + 1);

    if ("errors" in parsed) {
      errors.push(...parsed.errors);

      return;
    }

    if (seen.has(parsed.entry.id)) {
      errors.push({ line: index + 1, field: "id", message: "Ten identyfikator już jest w pliku." });

      return;
    }

    seen.add(parsed.entry.id);
    entries.push(parsed.entry);
  });

  if (errors.length === 0 && entries.length === 0) {
    return fileError("Plik nie zawiera żadnej aktualności.");
  }

  if (errors.length === 0 && entries.length > MAX_NEWS_PER_ORGANIZATION) {
    return fileError(`Plik ma więcej niż ${MAX_NEWS_PER_ORGANIZATION} aktualności.`);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, entries };
}
