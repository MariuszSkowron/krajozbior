import { isUuid } from "@/features/catalog/domain/uuid";
import {
  AuthenticationRequiredError,
  requireActor,
  type Actor,
} from "@/features/identity/domain/actor";

import { PAST_VISIT_ACTION, pastVisitLimit } from "../domain/limits";
import { parsePastVisitRequest } from "../domain/past-visit-request";
import type { PastVisitResponse, VisitDeps, VisitUseCaseOutcome } from "./visit-types";

// Visits from the past (E2, D-10, D-T9). The actor is the session, never a
// parameter; the owner of a row is app_current_user_id() in the database. Order:
// actor, limit, shape and date, then the user context. One past visit per
// place: a place the explorer already has a visit of (any kind) is skipped
// without an error. A batch with a place that is not publicly visible writes
// nothing (the check and the write are one statement) and answers `not_found`
// for the whole batch, so the answer does not tell which one it was.

async function signedIn(
  actor: Actor | null,
): Promise<Actor | Extract<VisitUseCaseOutcome<never>, { status: "unauthenticated" }>> {
  try {
    return requireActor(actor);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { status: "unauthenticated" };
    }
    throw error;
  }
}

export async function markPastVisits(
  actor: Actor | null,
  body: unknown,
  deps: VisitDeps,
  now: Date = new Date(),
): Promise<VisitUseCaseOutcome<PastVisitResponse>> {
  const who = await signedIn(actor);

  if ("status" in who) {
    return who;
  }

  const decision = await deps.limiter.reserve(PAST_VISIT_ACTION, who.id, pastVisitLimit);

  if (!decision.allowed) {
    return { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds };
  }

  const request = parsePastVisitRequest(body, now);

  if (request === null) {
    return { status: "invalid" };
  }

  return deps.withUserContext(who, async (tx) => {
    const { visible, recorded } = await deps.repository.markPastVisits(tx, request.placeIds, {
      visitedOn: request.visitedOn,
      precision: request.precision,
    });

    if (visible < request.placeIds.length) {
      return { status: "not_found" } as const;
    }

    return {
      status: "ok",
      value: { recorded, alreadyVisited: request.placeIds.length - recorded },
    } as const;
  });
}

/**
 * Takes back the explorer's own visit from the past of a place. A visit
 * confirmed on site is never touched. Nothing to remove is not an error.
 */
export async function deleteMyPastVisit(
  actor: Actor | null,
  placeId: string,
  deps: VisitDeps,
): Promise<VisitUseCaseOutcome<{ removed: number }>> {
  const who = await signedIn(actor);

  if ("status" in who) {
    return who;
  }

  const decision = await deps.limiter.reserve(PAST_VISIT_ACTION, who.id, pastVisitLimit);

  if (!decision.allowed) {
    return { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds };
  }

  if (!isUuid(placeId)) {
    return { status: "not_found" };
  }

  return deps.withUserContext(who, async (tx) => ({
    status: "ok",
    value: { removed: await deps.repository.deleteMyPastVisits(tx, placeId) },
  }));
}

/** The kind of the signed-in explorer's visit of a place (for the place page). */
export async function getMyVisitOfPlace(actor: Actor | null, placeId: string, deps: VisitDeps) {
  const who = await signedIn(actor);

  if ("status" in who) {
    return who;
  }

  if (!isUuid(placeId)) {
    return { status: "not_found" } as const;
  }

  return deps.withUserContext(who, async (tx) => ({
    status: "ok" as const,
    value: await deps.repository.getMyVisitOfPlace(tx, placeId),
  }));
}

/** The kinds of the signed-in explorer's visits for the places of a collection (for its page). */
export async function listMyVisitKindsOfCollection(
  actor: Actor | null,
  collectionId: string,
  deps: VisitDeps,
) {
  const who = await signedIn(actor);

  if ("status" in who) {
    return who;
  }

  if (!isUuid(collectionId)) {
    return { status: "not_found" } as const;
  }

  return deps.withUserContext(who, async (tx) => ({
    status: "ok" as const,
    value: await deps.repository.listMyVisitKindsOfCollection(tx, collectionId),
  }));
}
