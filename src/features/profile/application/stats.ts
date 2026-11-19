import { isRegion } from "@/features/catalog/domain/collection";
import type { Actor } from "@/features/identity/domain/actor";

import { kmInTransit, type ProfileStats } from "../domain/stats";
import type { ProfileStatsDeps } from "./stats-types";

export type ProfileStatsOutcome =
  Readonly<{ status: "ok"; value: ProfileStats }> | Readonly<{ status: "unauthenticated" }>;

/**
 * The actor's own numbers (E9-3, D-E9-5): places, regions and the kilometres in transit.
 * Read in the user context, so another person's visits never enter the count; a guest
 * gets `unauthenticated` before anything else happens.
 */
export async function getMyStats(
  actor: Actor | null,
  deps: ProfileStatsDeps,
): Promise<ProfileStatsOutcome> {
  if (actor === null) {
    return { status: "unauthenticated" };
  }

  const data = await deps.withUserContext(actor, (tx) => deps.repository.readVisitStats(tx));

  return {
    status: "ok",
    value: {
      visitedPlaces: data.visitedPlaces,
      // Only voivodeships of the list count, whatever else a collection might carry.
      regions: new Set(data.regions.filter((region) => isRegion(region))).size,
      kmInTransit: kmInTransit(data.visits),
    },
  };
}
