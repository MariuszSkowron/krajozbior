import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import type { StatsVisit } from "../domain/stats";

// The raw material of the statistics, read in the user context of the actor: no method
// takes a user id (the owner is app_current_user_id() in SQL) and the row policies of
// `visits` are the second barrier.
export type VisitStatsData = Readonly<{
  /** Places of public collections the actor visited, either kind (Q5). */
  visitedPlaces: number;
  /** Regions of public regional collections holding a visited place (Q4, D-34). */
  regions: readonly string[];
  /** Visits to public places with the place coordinates, oldest first. */
  visits: readonly StatsVisit[];
}>;

export interface ProfileStatsRepository {
  readVisitStats(tx: TransactionContext): Promise<VisitStatsData>;
}

export type ProfileStatsDeps = Readonly<{
  withUserContext: <T>(
    actor: Pick<Actor, "id">,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  repository: ProfileStatsRepository;
}>;
