import "server-only";

import { getActionRateLimiter } from "@/features/identity/infrastructure";
import { withUserContext } from "@/lib/db/user-context";

import type { ProfileDeps } from "../application/profile-types";
import type { ProfileStatsDeps } from "../application/stats-types";
import { postgresProfileRepository } from "./postgres-profile-repository";
import { postgresProfileStatsRepository } from "./postgres-stats-repository";

// The real dependencies of the statistics use case (E9-3).
export function getProfileStatsDeps(): ProfileStatsDeps {
  return { withUserContext, repository: postgresProfileStatsRepository };
}

// The real dependencies of the profile use cases.
export function getProfileDeps(): ProfileDeps {
  return {
    withUserContext,
    limiter: getActionRateLimiter(),
    repository: postgresProfileRepository,
  };
}
