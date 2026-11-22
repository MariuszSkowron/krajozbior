import { parseNewsBody, type NewsBodyParagraph } from "./news-body";

// What a reader (a guest included) sees of a published news item (E7-R3, spec E7 14.5):
// pure helpers for the address, the filter, the dates and the body. No Next.js, no database.

/** How many of the newest items the list shows (a page without paging, [P]). */
export const NEWS_LIST_LIMIT = 50;

/** How many published events the filter "Wydarzenia" reads before it drops the ended ones. */
export const NEWS_EVENT_FILTER_LIMIT = 200;

// The pattern and the length of the `slug` CHECK of `news_posts` (E7-R1).
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NEWS_SLUG_MAX_LENGTH = 80;

/** The address of an item has the shape the database enforces; anything else is a 404 without a query. */
export function isNewsSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= NEWS_SLUG_MAX_LENGTH && SLUG.test(value);
}

export type NewsFilter = "events" | null;

/** `?filtr=wydarzenia` is the only filter; any other value shows all items. */
export function parseNewsFilter(raw: string | string[] | undefined): NewsFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;

  return value === "wydarzenia" ? "events" : null;
}

const dateParts = new Intl.DateTimeFormat("en-CA", {
  day: "numeric",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Warsaw",
});

type DayParts = { day: string; month: string; year: string };

function partsOf(date: Date): DayParts {
  const parts = Object.fromEntries(dateParts.formatToParts(date).map((p) => [p.type, p.value]));

  return { day: parts.day ?? "", month: parts.month ?? "", year: parts.year ?? "" };
}

function numeric({ day, month, year }: DayParts): string {
  return `${day}.${month}.${year}`;
}

/** `17.04.2027` for a moment, in Poland (voice and tone, rule 8: day without a leading zero). */
export function formatNewsDate(date: Date): string {
  return numeric(partsOf(date));
}

/** `YYYY-MM-DD` of a moment in Poland, for the `datetime` attribute. */
export function newsDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Warsaw",
  }).format(date);
}

function dayParts(day: string): DayParts {
  // A calendar day has no time zone: noon UTC is the same day in Poland all year.
  return partsOf(new Date(`${day}T12:00:00Z`));
}

/**
 * `17.04.2027` for one day; for several days the shared month and year are written once:
 * `17–18.04.2027`, `30.04–2.05.2027`, and in full across years.
 */
export function formatEventDays(startsOn: string, endsOn: string | null): string {
  const start = dayParts(startsOn);

  if (endsOn === null || endsOn === startsOn) {
    return numeric(start);
  }

  const end = dayParts(endsOn);

  if (start.year !== end.year) {
    return `${numeric(start)}–${numeric(end)}`;
  }

  if (start.month !== end.month) {
    return `${start.day}.${start.month}–${numeric(end)}`;
  }

  return `${start.day}–${numeric(end)}`;
}

/** The first letter of the organization name, upper case; `?` for an empty name. */
export function organizationInitial(name: string): string {
  const first = [...name.trim()][0];

  return first === undefined ? "?" : first.toLocaleUpperCase("pl-PL");
}

/**
 * The paragraphs of a body for display. The body was checked when it was saved, so a
 * refusal here means data that did not come through the checks: it is shown as plain
 * text, never as links.
 */
export function newsBodyParagraphs(body: string): readonly NewsBodyParagraph[] {
  const parsed = parseNewsBody(body);

  if (parsed.ok) {
    return parsed.paragraphs;
  }

  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map((text) => [{ kind: "text", text }] as const);
}
