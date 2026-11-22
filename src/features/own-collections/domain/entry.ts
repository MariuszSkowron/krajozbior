// How an entry of an own collection is shown (E8-S2, E8-Q19).
//
// - `available`: the place is in a public collection now; it counts in the progress.
// - `unavailable`: the place exists, but is not public now (the curator withdrew the collection,
//   the organization was suspended): "Miejsce chwilowo niedostępne"; it does not count (D-14).
// - `removed`: the curator deleted the place (`place_id` was set to null, the name stayed):
//   "Miejsce usunięte przez kuratora: <nazwa>" with a button to remove the entry; it does not count.

export type EntryState = "available" | "unavailable" | "removed";

export function entryState(placeId: string | null, publicPlaceId: string | null): EntryState {
  if (placeId === null) {
    return "removed";
  }

  return publicPlaceId === null ? "unavailable" : "available";
}

export const UNAVAILABLE_PLACE_LABEL = "Miejsce chwilowo niedostępne";

/** The line of a removed entry; the name is the public name taken when the place was added. */
export function removedPlaceLabel(nameSnapshot: string): string {
  return `Miejsce usunięte przez kuratora: ${nameSnapshot}`;
}
