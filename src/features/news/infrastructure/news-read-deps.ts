import "server-only";

import { withGuestContext } from "@/lib/db/user-context";

import type { NewsReadDeps } from "../application/news-read-types";
import { postgresNewsReadRepository } from "./postgres-news-read-repository";

// The real dependencies of the public news reading.
export function getNewsReadDeps(): NewsReadDeps {
  return { withGuestContext, repository: postgresNewsReadRepository };
}
