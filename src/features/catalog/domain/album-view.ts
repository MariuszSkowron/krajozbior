// The view of a collection as an album (E12-4): the state filter of the places, the selected
// place, the links between the two and the date of the last change. Pure functions: the page
// reads the address, these decide what it means. An unknown value is the default one, never an
// error (the address can be written by anyone).

import { isUuid } from "./uuid";

export type StateFilter = "wszystkie" | "odwiedzone" | "do-odwiedzenia";

export const STATE_FILTERS: readonly StateFilter[] = ["wszystkie", "odwiedzone", "do-odwiedzenia"];

export const STATE_FILTER_LABELS: Readonly<Record<StateFilter, string>> = {
  wszystkie: "Wszystkie",
  odwiedzone: "Odwiedzone",
  "do-odwiedzenia": "Do odwiedzenia",
};

type Raw = string | readonly string[] | undefined;

const firstValue = (raw: Raw): string | undefined =>
  Array.isArray(raw) ? raw[0] : (raw as string);

/** `?stan=`: one of the three filters; anything else (or nothing) is "wszystkie". */
export function parseStateFilter(raw: Raw): StateFilter {
  const value = firstValue(raw);

  return STATE_FILTERS.find((filter) => filter === value) ?? "wszystkie";
}

/** `?miejsce=`: a place id, or `null` for nothing and for anything that is not a UUID. */
export function parseSelectedPlace(raw: Raw): string | null {
  const value = firstValue(raw);

  return isUuid(value) ? value.toLowerCase() : null;
}

/** `?widok=`: the list of cards (default) or the map (E12-5). Anything else is the cards. */
export type CollectionView = "karty" | "mapa";

export function parseView(raw: Raw): CollectionView {
  return firstValue(raw) === "mapa" ? "mapa" : "karty";
}

/** A place is "visited" with any visit of the explorer, on site or from the past (as in the progress). */
export type VisitKind = "on_site" | "past";

export type StateCounts = Readonly<Record<StateFilter, number>>;

export function countByState(
  placeIds: readonly string[],
  kinds: ReadonlyMap<string, VisitKind>,
): StateCounts {
  const visited = placeIds.filter((id) => kinds.has(id)).length;

  return {
    wszystkie: placeIds.length,
    odwiedzone: visited,
    "do-odwiedzenia": placeIds.length - visited,
  };
}

export function filterByState<T extends Readonly<{ id: string }>>(
  places: readonly T[],
  filter: StateFilter,
  kinds: ReadonlyMap<string, VisitKind>,
): readonly T[] {
  if (filter === "wszystkie") {
    return places;
  }

  return places.filter((place) => kinds.has(place.id) === (filter === "odwiedzone"));
}

/**
 * The address of the collection page with the chosen filter and place. The defaults are left
 * out, so the plain address stays plain. `slug` is a slug of the catalog (letters, digits,
 * hyphens), so it needs no escaping.
 */
export function albumHref(
  slug: string,
  view: Readonly<{ stan?: StateFilter; miejsce?: string | null; widok?: CollectionView }>,
): string {
  const query = new URLSearchParams();

  if (view.widok === "mapa") {
    query.set("widok", "mapa");
  }

  if (view.stan !== undefined && view.stan !== "wszystkie") {
    query.set("stan", view.stan);
  }

  if (view.miejsce !== undefined && view.miejsce !== null) {
    query.set("miejsce", view.miejsce);
  }

  const text = query.toString();

  return text === "" ? `/collections/${slug}` : `/collections/${slug}?${text}`;
}

const DATE = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** "8.11.2026": a single date (not a list), in Polish time. */
export function formatUpdateDate(date: Date): string {
  const part = (type: string) => DATE.formatToParts(date).find((p) => p.type === type)?.value ?? "";

  // No leading zeros ("5.3.2026"): the browser's own format pads the month, so it is spelled out.
  return `${Number(part("day"))}.${Number(part("month"))}.${part("year")}`;
}

/** The text of a description in the panel: whole words, at most `limit` characters, "…" when cut. */
export function shortenDescription(text: string, limit = 280): string {
  const trimmed = text.trim();

  if (trimmed.length <= limit) {
    return trimmed;
  }

  const cut = trimmed.slice(0, limit);
  const space = cut.lastIndexOf(" ");

  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
