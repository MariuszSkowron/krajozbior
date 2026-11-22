import "server-only";

import { getActionRateLimiter } from "@/features/identity/infrastructure";
import { withUserContext } from "@/lib/db/user-context";

import type { OwnCollectionsDeps } from "../application/own-collection-types";
import { postgresOwnCollectionsRepository } from "./postgres-own-collections-repository";

// The real dependencies of the own collection use cases.
export function getOwnCollectionsDeps(): OwnCollectionsDeps {
  return {
    withUserContext,
    limiter: getActionRateLimiter(),
    repository: postgresOwnCollectionsRepository,
  };
}
