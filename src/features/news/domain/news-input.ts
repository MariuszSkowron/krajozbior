import { z } from "zod";

import { normalizeLineBreaks } from "@/features/catalog/domain/collection";
import { isUuid } from "@/features/catalog/domain/uuid";

import { codePointLength, parseNewsBody, type NewsBodyError } from "./news-body";
import {
  NEWS_BODY_MAX_LENGTH,
  NEWS_HIDDEN_REASON_MAX_LENGTH,
  NEWS_HIDDEN_REASON_MIN_LENGTH,
  NEWS_LEAD_MAX_LENGTH,
  NEWS_LEAD_MIN_LENGTH,
  NEWS_MAX_LINKS,
  NEWS_TITLE_MAX_LENGTH,
  NEWS_TITLE_MIN_LENGTH,
} from "./limits";
import { NEWS_KINDS, type NewsKind } from "./news";

// Validation of what a curator saves (spec E7, D-E7-1, D-E7-3, Q11, Q18). Zod checks
// the shape of the body of a request; the rules of the text, the dates and the links
// follow in plain functions, so that one answer carries one Polish message per field.
// The database repeats the length and date rules in CHECK constraints (E7-1a).

export type NewsField =
  "kind" | "title" | "lead" | "body" | "collectionId" | "placeId" | "eventStartsOn" | "eventEndsOn";

export type NewsInputError = Readonly<{ field: NewsField; message: string }>;

/** A validated and normalized news form: texts in NFC, line breaks as LF, empty values as `null`. */
export type NewsInput = Readonly<{
  kind: NewsKind;
  title: string;
  lead: string;
  body: string;
  collectionId: string | null;
  placeId: string | null;
  eventStartsOn: string | null;
  eventEndsOn: string | null;
}>;

export type NewsValidation =
  | Readonly<{ ok: true; value: NewsInput }>
  | Readonly<{ ok: false; errors: readonly NewsInputError[] }>;

const SHAPE_MESSAGES = {
  body: "Treść ma nieprawidłowy format.",
  collectionId: "Wybierz kolekcję z listy.",
  placeId: "Wybierz miejsce z listy.",
  eventStartsOn: "Podaj poprawną datę rozpoczęcia.",
  eventEndsOn: "Podaj poprawną datę zakończenia.",
} as const;

const optionalText = (message: string) => z.string({ error: message }).nullish();

const newsShape = z.object({
  kind: z.enum(NEWS_KINDS, { error: "Wybierz rodzaj aktualności." }),
  title: z.string({ error: "Wpisz tytuł." }),
  lead: z.string({ error: "Wpisz krótki tekst." }),
  body: optionalText(SHAPE_MESSAGES.body),
  collectionId: optionalText(SHAPE_MESSAGES.collectionId),
  placeId: optionalText(SHAPE_MESSAGES.placeId),
  eventStartsOn: optionalText(SHAPE_MESSAGES.eventStartsOn),
  eventEndsOn: optionalText(SHAPE_MESSAGES.eventEndsOn),
});

const BODY_ERROR_MESSAGES: Readonly<Record<NewsBodyError, string>> = {
  too_long: `Treść może mieć najwyżej ${NEWS_BODY_MAX_LENGTH} znaków.`,
  too_many_links: `Treść może zawierać najwyżej ${NEWS_MAX_LINKS} linków.`,
  shortener: "Wpisz pełny adres strony zamiast skróconego.",
  credentials: "Adres w treści nie może zawierać nazwy użytkownika ani hasła.",
};

// Characters that change how text is read without being seen (text direction
// overrides and marks) are refused: they can disguise an address or a name.
function isHiddenDirection(code: number): boolean {
  return (
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** True for a control character (a line feed only when `allowLineFeed`) or a hidden direction mark. */
export function hasForbiddenCharacter(text: string, allowLineFeed: boolean): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);

    if ((isControl && !(allowLineFeed && code === 0x0a)) || isHiddenDirection(code)) {
      return true;
    }
  }

  return false;
}

function cleanText(value: string, multiline: boolean): string {
  const text = value.normalize("NFC");

  return (multiline ? normalizeLineBreaks(text) : text).trim();
}

// Checks one text: length in characters, then forbidden characters. Returns the message or null.
function textError(
  label: string,
  text: string,
  min: number,
  max: number,
  allowLineFeed: boolean,
): string | null {
  const length = codePointLength(text);

  if (length < min || length > max) {
    return min === 1
      ? `${label} ma mieć od 1 do ${max} znaków.`
      : `${label} ma mieć od ${min} do ${max} znaków.`;
  }

  return hasForbiddenCharacter(text, allowLineFeed)
    ? `${label} zawiera niedozwolone znaki sterujące.`
    : null;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written as `YYYY-MM-DD`. */
export function isCalendarDate(value: string): boolean {
  const match = DAY.exec(value);

  if (match === null) {
    return false;
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(0);

  date.setUTCFullYear(year, month - 1, day);

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// An empty value of an optional field is "not given".
function optionalValue(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();

  return text === "" ? null : text;
}

type Fields = Readonly<{
  kind: NewsKind;
  eventStartsOn: string | null;
  eventEndsOn: string | null;
}>;

// Q11: only an event has dates; it needs a start, and the end is not earlier.
function dateErrors({ kind, eventStartsOn, eventEndsOn }: Fields): NewsInputError[] {
  const errors: NewsInputError[] = [];

  if (kind !== "event") {
    if (eventStartsOn !== null) {
      errors.push({ field: "eventStartsOn", message: "Datę rozpoczęcia ma tylko wydarzenie." });
    }

    if (eventEndsOn !== null) {
      errors.push({ field: "eventEndsOn", message: "Datę zakończenia ma tylko wydarzenie." });
    }

    return errors;
  }

  const startValid = eventStartsOn !== null && isCalendarDate(eventStartsOn);
  const endValid = eventEndsOn !== null && isCalendarDate(eventEndsOn);

  if (eventStartsOn === null) {
    errors.push({ field: "eventStartsOn", message: "Podaj datę rozpoczęcia wydarzenia." });
  } else if (!startValid) {
    errors.push({ field: "eventStartsOn", message: SHAPE_MESSAGES.eventStartsOn });
  }

  if (eventEndsOn !== null && !endValid) {
    errors.push({ field: "eventEndsOn", message: SHAPE_MESSAGES.eventEndsOn });
  } else if (startValid && endValid && eventEndsOn < eventStartsOn) {
    errors.push({
      field: "eventEndsOn",
      message: "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.",
    });
  }

  return errors;
}

/**
 * Validates the form of a news item. Errors come one per field, in the order of the form.
 * The link policy of the body (Q18) is the one of `parseNewsBody`, so a body accepted here
 * always displays as written.
 */
export function validateNewsInput(input: unknown): NewsValidation {
  const shape = newsShape.safeParse(input);

  if (!shape.success) {
    // Zod reports at most one issue per field here; a body that is not an object
    // has no field in the path and is reported on the first field of the form.
    return {
      ok: false,
      errors: shape.error.issues.map((issue) => ({
        field: (issue.path[0] ?? "kind") as NewsField,
        message: issue.message,
      })),
    };
  }

  const errors: NewsInputError[] = [];
  const raw = shape.data;
  const title = cleanText(raw.title, false);
  const lead = cleanText(raw.lead, true);
  const body = cleanText(raw.body ?? "", true);
  const collectionId = optionalValue(raw.collectionId);
  const placeId = optionalValue(raw.placeId);

  const titleError = textError("Tytuł", title, NEWS_TITLE_MIN_LENGTH, NEWS_TITLE_MAX_LENGTH, false);
  const leadError = textError(
    "Krótki tekst",
    lead,
    NEWS_LEAD_MIN_LENGTH,
    NEWS_LEAD_MAX_LENGTH,
    true,
  );

  if (titleError !== null) {
    errors.push({ field: "title", message: titleError });
  }

  if (leadError !== null) {
    errors.push({ field: "lead", message: leadError });
  }

  if (hasForbiddenCharacter(body, true)) {
    errors.push({ field: "body", message: "Treść zawiera niedozwolone znaki sterujące." });
  } else {
    const parsed = parseNewsBody(body);

    if (!parsed.ok) {
      errors.push({ field: "body", message: BODY_ERROR_MESSAGES[parsed.error] });
    }
  }

  if (collectionId !== null && !isUuid(collectionId)) {
    errors.push({ field: "collectionId", message: SHAPE_MESSAGES.collectionId });
  }

  if (placeId !== null && !isUuid(placeId)) {
    errors.push({ field: "placeId", message: SHAPE_MESSAGES.placeId });
  }

  const eventStartsOn = optionalValue(raw.eventStartsOn);
  const eventEndsOn = optionalValue(raw.eventEndsOn);

  errors.push(...dateErrors({ kind: raw.kind, eventStartsOn, eventEndsOn }));

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      kind: raw.kind,
      title,
      lead,
      body,
      collectionId,
      placeId,
      eventStartsOn,
      eventEndsOn,
    },
  };
}

/**
 * The reason an operator gives when hiding a news item (D-E7-2): 10 to 400 characters,
 * the length `operations_audit.reason` holds. Returns the trimmed text or `null`.
 */
export function parseHiddenReason(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const reason = cleanText(value, false);
  const length = codePointLength(reason);

  if (
    length < NEWS_HIDDEN_REASON_MIN_LENGTH ||
    length > NEWS_HIDDEN_REASON_MAX_LENGTH ||
    hasForbiddenCharacter(reason, false)
  ) {
    return null;
  }

  return reason;
}
