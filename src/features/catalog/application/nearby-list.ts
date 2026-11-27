import type { NearbyCandidate } from "../domain/nearby";
import { createSharedCache } from "./shared-cache";

/** How long the public list for "Pokaż najbliższe" is kept in the memory of the server. */
export const NEARBY_LIST_TTL_MS = 5 * 60 * 1000;

/**
 * Drops repeated points of one collection (places rounded to the same spot). The distance to a
 * collection is the distance to its nearest place, so a repeated point changes nothing.
 */
export function dedupeNearbyPoints(
  candidates: readonly NearbyCandidate[],
): readonly NearbyCandidate[] {
  return candidates.map((candidate) => {
    const seen = new Set<string>();
    const points = candidate.points.filter(([latitude, longitude]) => {
      const key = `${latitude},${longitude}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });

    return points.length === candidate.points.length ? candidate : { ...candidate, points };
  });
}

/**
 * The list is public and the same for everyone, so one value serves all requests for five
 * minutes; requests that arrive while it is being read wait for that single read.
 */
export function createNearbyList(options: {
  read: () => Promise<readonly NearbyCandidate[]>;
  now: () => number;
  ttlMs?: number;
}): () => Promise<readonly NearbyCandidate[]> {
  const cache = createSharedCache<readonly NearbyCandidate[]>({
    ttlMs: options.ttlMs ?? NEARBY_LIST_TTL_MS,
    now: options.now,
  });

  return () => cache.get(async () => dedupeNearbyPoints(await options.read()));
}
