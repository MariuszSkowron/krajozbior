import "server-only";

import { getActionRateLimiter } from "@/features/identity/infrastructure";
import { withUserContext } from "@/lib/db/user-context";

import type { ProfileDeps } from "../application/profile-types";
import { postgresProfileRepository } from "./postgres-profile-repository";

// The real dependencies of the profile use cases.
export function getProfileDeps(): ProfileDeps {
  return {
    withUserContext,
    limiter: getActionRateLimiter(),
    repository: postgresProfileRepository,
  };
}
