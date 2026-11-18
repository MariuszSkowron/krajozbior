import "server-only";

import { postgresAlbumRepository } from "@/features/album/infrastructure/postgres-album-repository";
import { getActionRateLimiter } from "@/features/identity/infrastructure";
import { withUserContext } from "@/lib/db/user-context";

import type { VisitDeps } from "../application/visit-types";
import { postgresVisitRepository } from "./postgres-visit-repository";

// The real dependencies of the visit use cases.
export function getVisitDeps(): VisitDeps {
  return {
    withUserContext,
    limiter: getActionRateLimiter(),
    repository: postgresVisitRepository,
    album: postgresAlbumRepository,
  };
}
