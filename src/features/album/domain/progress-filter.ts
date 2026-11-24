// Filter of "Moje kolekcje" by the state of progress (E12-S4, spec 5.6). Pure functions.
// "Nierozpoczęte": nothing visited (an empty collection included); "W trakcie": at least one
// and not all places visited; "Ukończone": every place visited (a collection without places is
// never finished).

import type { Progress } from "./progress";

export const PROGRESS_FILTERS = ["wszystkie", "w-trakcie", "nierozpoczete", "ukonczone"] as const;

export type ProgressFilter = (typeof PROGRESS_FILTERS)[number];

export const PROGRESS_FILTER_LABELS: Readonly<Record<ProgressFilter, string>> = {
  wszystkie: "Wszystkie",
  "w-trakcie": "W trakcie",
  nierozpoczete: "Nierozpoczęte",
  ukonczone: "Ukończone",
};

/** A plain sentence per state that matches nothing (T-21): no system wording like "ze stanem". */
export function noMatchingCollectionsMessage(filter: ProgressFilter): string {
  switch (filter) {
    case "ukonczone":
      return "Nie masz jeszcze ukończonych kolekcji.";
    case "w-trakcie":
      return "Żadnej zapisanej kolekcji nie masz w trakcie.";
    case "nierozpoczete":
      return "Każdą zapisaną kolekcję masz już zaczętą.";
    case "wszystkie":
      return "Nie masz jeszcze zapisanych kolekcji.";
  }
}

/** The value of `?stan=`; anything unknown (or repeated) means "Wszystkie". */
export function parseProgressFilter(value: string | readonly string[] | undefined): ProgressFilter {
  return PROGRESS_FILTERS.find((filter) => filter === value) ?? "wszystkie";
}

export function matchesProgressFilter(progress: Progress, filter: ProgressFilter): boolean {
  const visited = progress.kind === "empty" ? 0 : progress.visited;
  const total = progress.kind === "empty" ? 0 : progress.total;

  switch (filter) {
    case "wszystkie":
      return true;
    case "nierozpoczete":
      return visited === 0;
    case "w-trakcie":
      return visited >= 1 && visited < total;
    case "ukonczone":
      return total > 0 && visited === total;
  }
}
