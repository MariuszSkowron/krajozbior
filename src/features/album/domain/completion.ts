import type { Progress } from "./progress";

// Completion of a collection by an explorer. Pure rules: whether the
// collection is complete now (computed on every read, never remembered) and
// the rounded date of the completing visit. No day of a visit ever leaves
// this module.

/** A collection is complete when it has places and every one is visited; "0/0" is never complete. */
export function isComplete(progress: Progress): boolean {
  return progress.kind === "progress" && progress.visited === progress.total;
}

/** The person's earliest visit of one place. `on` is `YYYY-MM-DD` (a month or a year is kept as its first day). */
export type FirstVisit = Readonly<{
  on: string | null;
  precision: "day" | "month" | "year" | "unknown";
}>;

/** Completion date rounded to a month, to a year, or none. */
export type CompletedOn =
  | Readonly<{ precision: "month"; year: number; month: number }>
  | Readonly<{ precision: "year"; year: number }>
  | null;

const DAY = /^(\d{4})-(\d{2})-\d{2}$/;

function yearAndMonth(on: string | null): { year: number; month: number } | null {
  const match = on === null ? null : DAY.exec(on);

  return match === null ? null : { year: Number(match[1]), month: Number(match[2]) };
}

/**
 * Date of the visit that completed the collection: the LATEST of the EARLIEST
 * visits of the visited places, rounded to a month. "I do not remember" visits
 * count as older than any dated one and never move the date; when all are
 * undated there is no date. A year-only visit is kept as 1 January, so it
 * would lose to a March visit of the same year though it may have been in
 * December: when the latest year-only visit has a year equal to or later than
 * the year of the latest dated visit, the result is the bare year.
 */
export function completedOn(firstVisits: readonly FirstVisit[]): CompletedOn {
  let latestDay: { year: number; month: number; on: string } | null = null;
  let latestYear: number | null = null;

  for (const visit of firstVisits) {
    const parts = visit.precision === "unknown" ? null : yearAndMonth(visit.on);
    if (parts === null || visit.on === null) {
      continue;
    }
    if (visit.precision === "year") {
      latestYear = latestYear === null ? parts.year : Math.max(latestYear, parts.year);
    } else if (latestDay === null || visit.on > latestDay.on) {
      latestDay = { ...parts, on: visit.on };
    }
  }

  if (latestYear !== null && (latestDay === null || latestYear >= latestDay.year)) {
    return { precision: "year", year: latestYear };
  }
  if (latestDay !== null) {
    return { precision: "month", year: latestDay.year, month: latestDay.month };
  }

  return null;
}
