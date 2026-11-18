import "server-only";

import { getActionRateLimiter } from "@/features/identity/infrastructure";
import { withUserContext } from "@/lib/db/user-context";

import type { WantToSeeDeps } from "../application/want-to-see-types";
import { postgresWantToSeeRepository } from "./postgres-want-to-see-repository";

// The real dependencies of the "Chcę zobaczyć" use cases.
export function getWantToSeeDeps(): WantToSeeDeps {
  return {
    withUserContext,
    limiter: getActionRateLimiter(),
    repository: postgresWantToSeeRepository,
  };
}
