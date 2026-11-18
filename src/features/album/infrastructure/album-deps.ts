import "server-only";

import { getActionRateLimiter } from "@/features/identity/infrastructure";
import { withUserContext } from "@/lib/db/user-context";

import type { AlbumDeps } from "../application/album-types";
import { postgresAlbumRepository } from "./postgres-album-repository";

// The real dependencies of the album use cases.
export function getAlbumDeps(): AlbumDeps {
  return {
    withUserContext,
    limiter: getActionRateLimiter(),
    repository: postgresAlbumRepository,
  };
}
