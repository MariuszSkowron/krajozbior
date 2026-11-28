import { isUuid } from "@/features/catalog/domain/uuid";
import { warsawToday } from "@/lib/time/warsaw-today";

import { MAX_PAST_VISITS_PER_REQUEST } from "./limits";
import { DATE_PRECISIONS } from "./visit-outcome";

// The body of POST /api/me/visits/past: places the explorer says they have
// visited earlier, and one date shared by all of them (spec E2, D-10, D-T9).
// Only the shape and the date are checked here; whether a place is visible is
// decided by the database (policies of visits) in the same statement as the write.

export type DatePrecision = (typeof DATE_PRECISIONS)[number];

export type PastVisitRequest = Readonly<{
  placeIds: readonly string[];
  precision: DatePrecision;
  /** The date the row stores (YYYY-MM-DD), or null for "unknown". */
  visitedOn: string | null;
}>;

/** The earliest date accepted. */
export const EARLIEST_VISIT_DATE = "1900-01-01";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const YEAR = /^\d{4}$/;

function normalize(precision: DatePrecision, value: unknown): string | null | undefined {
  if (precision === "unknown") {
    return value === undefined || value === null ? null : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  if (precision === "year") {
    return YEAR.test(value) ? `${value}-01-01` : undefined;
  }

  if (precision === "month") {
    const match = MONTH.exec(value);
    const month = Number(match?.[2]);

    return match !== null && month >= 1 && month <= 12 ? `${value}-01` : undefined;
  }

  const match = DAY.exec(value);

  if (match === null) {
    return undefined;
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));

  // A date that rolls over (31 February) does not round-trip.
  return date.toISOString().slice(0, 10) === value ? value : undefined;
}

/**
 * Parses and validates the body. Returns null for anything wrong: not an
 * object, the list not 1 to 100 UUIDs, an unknown precision, a value that does
 * not match the precision, a date in the future (a day in Poland, the clock is
 * `now`) or before 1900. Duplicate ids are merged. A month is stored as its
 * first day and a year as 1 January.
 */
export function parsePastVisitRequest(body: unknown, now: Date): PastVisitRequest | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const { placeIds, date } = body as Record<string, unknown>;

  if (
    !Array.isArray(placeIds) ||
    placeIds.length < 1 ||
    placeIds.length > MAX_PAST_VISITS_PER_REQUEST ||
    !placeIds.every(isUuid) ||
    typeof date !== "object" ||
    date === null ||
    Array.isArray(date)
  ) {
    return null;
  }

  const { precision, value } = date as Record<string, unknown>;

  if (!(DATE_PRECISIONS as readonly unknown[]).includes(precision)) {
    return null;
  }

  const visitedOn = normalize(precision as DatePrecision, value);

  if (visitedOn === undefined) {
    return null;
  }

  if (visitedOn !== null && (visitedOn < EARLIEST_VISIT_DATE || visitedOn > warsawToday(now))) {
    return null;
  }

  return {
    placeIds: [...new Set((placeIds as string[]).map((id) => id.toLowerCase()))],
    precision: precision as DatePrecision,
    visitedOn,
  };
}

const MONTHS_NOMINATIVE = [
  "styczeń",
  "luty",
  "marzec",
  "kwiecień",
  "maj",
  "czerwiec",
  "lipiec",
  "sierpień",
  "wrzesień",
  "październik",
  "listopad",
  "grudzień",
] as const;

const MONTHS_GENITIVE = [
  "stycznia",
  "lutego",
  "marca",
  "kwietnia",
  "maja",
  "czerwca",
  "lipca",
  "sierpnia",
  "września",
  "października",
  "listopada",
  "grudnia",
] as const;

/**
 * The stored date as text by its precision: "12 marca 2019", "marzec 2019",
 * "2019", "data nieznana". `visitedOn` is YYYY-MM-DD, null for "unknown".
 */
export function formatPastVisitDate(precision: DatePrecision, visitedOn: string | null): string {
  if (precision === "unknown" || visitedOn === null) {
    return "data nieznana";
  }

  const [year, month, day] = visitedOn.split("-").map(Number) as [number, number, number];

  if (precision === "year") {
    return String(year);
  }

  if (precision === "month") {
    return `${MONTHS_NOMINATIVE[month - 1]} ${year}`;
  }

  return `${day} ${MONTHS_GENITIVE[month - 1]} ${year}`;
}
