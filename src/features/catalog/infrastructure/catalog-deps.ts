import "server-only";

import { randomInt } from "node:crypto";

import { getActionRateLimiter } from "@/features/identity/infrastructure";
import { withGuestContext, withUserContext } from "@/lib/db/user-context";

import type { CatalogDeps } from "../application/catalog-types";
import { postgresCatalogRepository } from "./postgres-catalog-repository";

// The real dependencies of the catalog use cases. The limiter is created per
// call: it only wraps the shared pool of the identity adapter.
export function getCatalogDeps(): CatalogDeps {
  return {
    withUserContext,
    withGuestContext,
    limiter: getActionRateLimiter(),
    repository: postgresCatalogRepository,
    random: (max) => randomInt(max),
  };
}
