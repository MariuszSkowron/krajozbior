import "server-only";

import { withUserContext } from "@/lib/db/user-context";

import type { TermsDeps } from "../application/terms-types";
import { postgresTermsRepository } from "./postgres-terms-repository";

// Prawdziwe zależności przypadków użycia akceptacji regulaminu.
export function getTermsDeps(): TermsDeps {
  return { withUserContext, repository: postgresTermsRepository };
}
