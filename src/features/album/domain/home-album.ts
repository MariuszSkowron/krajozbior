import { formatSavedDate } from "@/features/want-to-see/domain/saved-date";
import {
  formatPastVisitDate,
  type DatePrecision,
} from "@/features/visits/domain/past-visit-request";
import type { VISIT_KINDS } from "@/features/visits/domain/visit-outcome";

// What the home page of a signed-in explorer shows of the album (E12-1). The
// rules of what counts live in the SQL of the repository (D-E12-1a); this module
// holds the limits and the text of a visit, the only logic that needs no database.

/** Favourite collections read for the home page; the phone shows the first FAVORITES_ON_PHONE. */
export const HOME_FAVORITES_LIMIT = 6;
export const HOME_FAVORITES_ON_PHONE = 4;
/** Latest visits read for the home page. */
export const HOME_RECENT_VISITS_LIMIT = 5;

export const VISIT_KIND_LABELS: Readonly<Record<(typeof VISIT_KINDS)[number], string>> = {
  on_site: "potwierdzona na miejscu",
  past: "z przeszłości",
};

// One of the latest visits as the repository reads it. `place` is null when the
// place is not in any public collection (any more).
export type HomeRecentVisit = Readonly<{
  id: string;
  kind: (typeof VISIT_KINDS)[number];
  visitedAt: Date;
  visitedOn: string | null;
  precision: DatePrecision | null;
  place: Readonly<{ id: string; name: string; address: string }> | null;
}>;

export type VisitLine = Readonly<{
  id: string;
  kindLabel: string;
  dateText: string;
  /** `null`: "Miejsce niedostępne w katalogu" - no name, no address, no link. */
  place: Readonly<{ href: string; name: string; address: string }> | null;
}>;

/**
 * The line of one visit: a visit from the past shows the date the explorer gave
 * with its precision ("marzec 2019", "data nieznana"); a visit on site shows the
 * day it was confirmed.
 */
export function describeVisit(visit: HomeRecentVisit): VisitLine {
  const dateText =
    visit.kind === "past" && visit.precision !== null
      ? formatPastVisitDate(visit.precision, visit.visitedOn)
      : formatSavedDate(visit.visitedAt);

  return {
    id: visit.id,
    kindLabel: VISIT_KIND_LABELS[visit.kind],
    dateText,
    place:
      visit.place === null
        ? null
        : {
            href: `/places/${visit.place.id}`,
            name: visit.place.name,
            address: visit.place.address,
          },
  };
}
