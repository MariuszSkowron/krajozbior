import { z } from "zod";

import { normalizeLineBreaks } from "@/features/catalog/domain/collection";
import { isUuid } from "@/features/catalog/domain/uuid";

import { codePointLength, parseNewsBody, type NewsBodyError } from "./news-body";
import {
  NEWS_BODY_MAX_LENGTH,
  NEWS_EVENT_MAX_DATE,
  NEWS_EVENT_MIN_DATE,
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

const NEWS_FIELD_NAMES = [
  "kind",
  "title",
  "lead",
  "body",
  "collectionId",
  "placeId",
  "eventStartsOn",
  "eventEndsOn",
] as const;

/** A field of the form; `form` is an error of the whole input (not an object, an unknown field). */
export type NewsField = (typeof NEWS_FIELD_NAMES)[number] | "form";

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

const FORM_MESSAGE = "Formularz ma nieprawidłowy format.";

const newsShape = z.object(
  {
    kind: z.enum(NEWS_KINDS, { error: "Wybierz rodzaj aktualności." }),
    title: z.string({ error: "Wpisz tytuł." }),
    lead: z.string({ error: "Wpisz krótki tekst." }),
    body: optionalText(SHAPE_MESSAGES.body),
    collectionId: optionalText(SHAPE_MESSAGES.collectionId),
    placeId: optionalText(SHAPE_MESSAGES.placeId),
    eventStartsOn: optionalText(SHAPE_MESSAGES.eventStartsOn),
    eventEndsOn: optionalText(SHAPE_MESSAGES.eventEndsOn),
  },
  { error: FORM_MESSAGE },
);

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

/**
 * True for a control character (a line feed only when `allowLineFeed`), a hidden
 * direction mark or a lone surrogate (N2: the database would store it as U+FFFD).
 */
export function hasForbiddenCharacter(text: string, allowLineFeed: boolean): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isLoneSurrogate = code >= 0xd800 && code <= 0xdfff;

    if (
      (isControl && !(allowLineFeed && code === 0x0a)) ||
      isHiddenDirection(code) ||
      isLoneSurrogate
    ) {
      return true;
    }
  }

  return false;
}

// Characters with no visible shape: zero-width spaces and joiners, the word joiner,
// the byte order mark, a soft hyphen, invisible operators, fillers, line and
// paragraph separators. A title made only of them would show as an empty card (S5).
function isInvisible(code: number): boolean {
  return (
    code === 0x00ad ||
    code === 0x034f ||
    code === 0x115f ||
    code === 0x1160 ||
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200d) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x2060 && code <= 0x2064) ||
    code === 0x3164 ||
    code === 0xfeff ||
    code === 0xffa0
  );
}

/** Length in characters without the invisible ones. */
export function visibleLength(text: string): number {
  let length = 0;

  for (const char of text) {
    if (!isInvisible(char.codePointAt(0) as number)) {
      length += 1;
    }
  }

  return length;
}

function cleanText(value: string, multiline: boolean): string {
  const text = value.normalize("NFC");

  return (multiline ? normalizeLineBreaks(text) : text).trim();
}

type TextRule = Readonly<{
  label: string;
  min: number;
  max: number;
  multiline: boolean;
}>;

const rangeMessage = (label: string, min: number, max: number) =>
  min === 1
    ? `${label} ma mieć od 1 do ${max} znaków.`
    : `${label} ma mieć od ${min} do ${max} znaków.`;

// Cleans and checks one text. The raw length is cut first (S1), before the
// normalization copies the text: even with every character a two-unit one, or a CRLF,
// more than twice the limit is over it. Returns the cleaned text and the message or null.
function checkText(raw: string, rule: TextRule): Readonly<{ text: string; error: string | null }> {
  const { label, min, max, multiline } = rule;

  if (raw.length > max * 2) {
    return { text: "", error: rangeMessage(label, min, max) };
  }

  const text = cleanText(raw, multiline);
  const length = codePointLength(text);

  if (length < min || length > max) {
    return { text, error: rangeMessage(label, min, max) };
  }

  if (hasForbiddenCharacter(text, multiline)) {
    return { text, error: `${label} zawiera niedozwolone znaki sterujące.` };
  }

  // The minimum counts only visible characters (S5).
  if (visibleLength(text) < min) {
    return {
      text,
      error:
        min === 1
          ? `${label} musi zawierać widoczne znaki.`
          : `${label} musi mieć co najmniej ${min} widocznych znaków.`,
    };
  }

  return { text, error: null };
}

const TITLE_RULE: TextRule = {
  label: "Tytuł",
  min: NEWS_TITLE_MIN_LENGTH,
  max: NEWS_TITLE_MAX_LENGTH,
  multiline: false,
};

const LEAD_RULE: TextRule = {
  label: "Krótki tekst",
  min: NEWS_LEAD_MIN_LENGTH,
  max: NEWS_LEAD_MAX_LENGTH,
  multiline: true,
};

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

/** A real date within the range an event may have (S3); `YYYY-MM-DD` compares as text. */
export function isEventDate(value: string): boolean {
  return isCalendarDate(value) && value >= NEWS_EVENT_MIN_DATE && value <= NEWS_EVENT_MAX_DATE;
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

  const startValid = eventStartsOn !== null && isEventDate(eventStartsOn);
  const endValid = eventEndsOn !== null && isEventDate(eventEndsOn);

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

export type NewsValidationOptions = Readonly<{
  /**
   * Refuse a field that is not on the form, instead of dropping it silently. For the
   * import of the editorial file (E7-R), where a typo in a name must not vanish.
   */
  strict?: boolean;
}>;

function unknownFieldErrors(input: object): NewsInputError[] {
  const known: readonly string[] = NEWS_FIELD_NAMES;

  return Object.keys(input)
    .filter((key) => !known.includes(key))
    .map((key) => ({
      field: "form" as const,
      message: `Nieznane pole: „${key.slice(0, 40)}”.`,
    }));
}

/**
 * Validates the form of a news item. Errors come one per field, in the order of the form.
 * The link policy of the body (Q18) is the one of `parseNewsBody`, so a body accepted here
 * always displays as written. Unknown fields are dropped, or refused with `strict`.
 */
export function validateNewsInput(
  input: unknown,
  options: NewsValidationOptions = {},
): NewsValidation {
  if (options.strict === true && typeof input === "object" && input !== null) {
    const unknown = unknownFieldErrors(input);

    if (unknown.length > 0) {
      return { ok: false, errors: unknown };
    }
  }

  const shape = newsShape.safeParse(input);

  if (!shape.success) {
    // Zod reports at most one issue per field here; an input that is not an object
    // has no field in the path and is reported on the whole form.
    return {
      ok: false,
      errors: shape.error.issues.map((issue) => ({
        field: (issue.path[0] ?? "form") as NewsField,
        message: issue.message,
      })),
    };
  }

  const errors: NewsInputError[] = [];
  const raw = shape.data;
  const titleCheck = checkText(raw.title, TITLE_RULE);
  const leadCheck = checkText(raw.lead, LEAD_RULE);
  const title = titleCheck.text;
  const lead = leadCheck.text;
  const collectionId = optionalValue(raw.collectionId);
  const placeId = optionalValue(raw.placeId);

  if (titleCheck.error !== null) {
    errors.push({ field: "title", message: titleCheck.error });
  }

  if (leadCheck.error !== null) {
    errors.push({ field: "lead", message: leadCheck.error });
  }

  const rawBody = raw.body ?? "";
  const body = rawBody.length > NEWS_BODY_MAX_LENGTH * 2 ? "" : cleanText(rawBody, true);

  if (rawBody.length > NEWS_BODY_MAX_LENGTH * 2) {
    errors.push({ field: "body", message: BODY_ERROR_MESSAGES.too_long });
  } else if (hasForbiddenCharacter(body, true)) {
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
  if (typeof value !== "string" || value.length > NEWS_HIDDEN_REASON_MAX_LENGTH * 2) {
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
