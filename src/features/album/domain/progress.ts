// Progress of an explorer in one collection (E2; spec section 5.1, "Postęp").
// The rule lives only here: the database returns the places currently in the
// collection and the places the person visited (any kind of visit), and this
// function counts. One rule for the collection card, "Moje kolekcje" and later
// uses.
//
// - Y = places currently in the collection; X = those of them with at least one
//   visit of the person. A visited place that is no longer in the collection
//   counts in neither (the visit stays in the person's history, R-07, D-14).
// - One visit counts the place in every collection that holds it (D-14).
// - A collection without places is a state of its own, shown as "0/0".

export type Progress =
  Readonly<{ kind: "empty" }> | Readonly<{ kind: "progress"; visited: number; total: number }>;

export function computeProgress(
  collectionPlaceIds: Iterable<string>,
  visitedPlaceIds: Iterable<string>,
): Progress {
  const places = new Set(collectionPlaceIds); // a place listed twice is still one place
  const visitedSet = new Set(visitedPlaceIds);
  let visited = 0;

  for (const placeId of places) {
    if (visitedSet.has(placeId)) {
      visited += 1;
    }
  }

  return places.size === 0 ? { kind: "empty" } : { kind: "progress", visited, total: places.size };
}

/** The numbers of the progress bar: the empty state is 0 of 0. */
export function progressCounts(progress: Progress): Readonly<{ visited: number; total: number }> {
  return progress.kind === "empty"
    ? { visited: 0, total: 0 }
    : { visited: progress.visited, total: progress.total };
}

/** "9/24", never a percentage (R-06); an empty collection reads "0/0". */
export function formatProgress(progress: Progress): string {
  const { visited, total } = progressCounts(progress);

  return `${visited}/${total}`;
}
