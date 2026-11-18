import {
  AuthenticationRequiredError,
  requireActor,
  type Actor,
} from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import { CURATOR_WRITE_ACTION, curatorWriteLimit } from "../domain/limits";
import type { CatalogDeps, CuratorOutcome } from "./catalog-types";

type Refusal = Exclude<CuratorOutcome<never>, { status: "ok" }>;

/**
 * First steps of every curator use case: the actor comes from the session
 * (never from the caller), then the write limit is counted. Nothing else is
 * checked before the limit, so a refusal reveals nothing.
 */
export async function admitCurator(
  actor: Actor | null,
  deps: CatalogDeps,
): Promise<{ actor: Actor } | { refusal: Refusal }> {
  let signedIn: Actor;

  try {
    signedIn = requireActor(actor);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { refusal: { status: "unauthenticated" } };
    }
    throw error;
  }

  const decision = await deps.limiter.reserve(CURATOR_WRITE_ACTION, signedIn.id, curatorWriteLimit);

  if (!decision.allowed) {
    return { refusal: { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds } };
  }

  return { actor: signedIn };
}

/**
 * Runs `work` in the user context of the actor. A caller without a membership
 * in an approved organization gets `forbidden` before anything else; which
 * organizations count is decided by the database (app_org_permission).
 */
export async function inCuratorContext<T>(
  actor: Actor,
  deps: CatalogDeps,
  work: (tx: TransactionContext, organizationIds: readonly string[]) => Promise<CuratorOutcome<T>>,
): Promise<CuratorOutcome<T>> {
  return deps.withUserContext(actor, async (tx) => {
    const organizationIds = await deps.repository.permittedOrganizationIds(tx);

    if (organizationIds.length === 0) {
      return { status: "forbidden" } as const;
    }

    return work(tx, organizationIds);
  });
}
