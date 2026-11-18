// Order of places in a collection (positions start at 1).

/** Next free position after the highest one, or 1 for an empty collection. */
export function nextPosition(positions: readonly number[]): number {
  return positions.reduce((highest, position) => Math.max(highest, position), 0) + 1;
}

export type ReorderDecision =
  Readonly<{ ok: true; placeIds: readonly string[] }> | Readonly<{ ok: false }>;

// The new order must list every place of the collection exactly once.
export function validateReorder(
  currentPlaceIds: readonly string[],
  requested: unknown,
): ReorderDecision {
  if (!Array.isArray(requested) || requested.some((id) => typeof id !== "string")) {
    return { ok: false };
  }

  const ids = requested as string[];
  const current = new Set(currentPlaceIds);

  if (ids.length !== current.size || new Set(ids).size !== ids.length) {
    return { ok: false };
  }

  return ids.every((id) => current.has(id)) ? { ok: true, placeIds: ids } : { ok: false };
}
