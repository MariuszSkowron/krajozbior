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

/** The sentence for a state that matches nothing; a one-letter word never ends a line ("ze stanem", „W trakcie”). */
export function noMatchingCollectionsMessage(filter: ProgressFilter): string {
  const label = PROGRESS_FILTER_LABELS[filter].replace(/(^|\s)(\p{L}) /gu, "$1$2 ");

  return `Nie ma zapisanych kolekcji ze stanem „${label}”.`;
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
