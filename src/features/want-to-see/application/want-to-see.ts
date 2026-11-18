import { isUuid } from "@/features/catalog/domain/uuid";
import {
  AuthenticationRequiredError,
  requireActor,
  type Actor,
} from "@/features/identity/domain/actor";

import { WANT_TO_SEE_WRITE_ACTION, wantToSeeWriteLimit } from "../domain/limits";
import type { WantToSeeDeps, WantToSeeOutcome, WantToSeePlace } from "./want-to-see-types";

// The "Chcę zobaczyć" list of the explorer (E2-S5, PR8). Every use case takes
// the actor from the session and never a user id: the owner of a row is
// app_current_user_id() in the database, and the row policies are the second
// barrier. A guest gets `unauthenticated` before anything else happens.

type Refusal = Exclude<WantToSeeOutcome<never>, { status: "ok" }>;

async function admit(
  actor: Actor | null,
  deps: WantToSeeDeps,
  { counted }: { counted: boolean },
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

  if (counted) {
    const decision = await deps.limiter.reserve(
      WANT_TO_SEE_WRITE_ACTION,
      signedIn.id,
      wantToSeeWriteLimit,
    );

    if (!decision.allowed) {
      return { refusal: { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds } };
    }
  }

  return { actor: signedIn };
}

/**
 * Adds a publicly visible place to the list. Idempotent: a repeated add is
 * `ok`. A place that is only in a draft, in a withdrawn collection or in one of
 * a suspended organization, and a missing id, all give the same `not_found`.
 */
export async function addToWantToSee(
  actor: Actor | null,
  placeId: string,
  deps: WantToSeeDeps,
): Promise<WantToSeeOutcome<{ wanted: true }>> {
  const admitted = await admit(actor, deps, { counted: true });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isUuid(placeId)) {
    return { status: "not_found" };
  }

  return deps.withUserContext(admitted.actor, async (tx) => {
    if (!(await deps.repository.isPubliclyVisiblePlace(tx, placeId))) {
      return { status: "not_found" } as const;
    }

    // The insert tests visibility itself: a place that stopped being public after
    // the check above is `not_found`, not a refusal of the row policy.
    const added = await deps.repository.addPlace(tx, placeId);

    if (added === "not_found") {
      return { status: "not_found" } as const;
    }

    if (added === "too_many") {
      return { status: "conflict", reason: "too_many_wanted" } as const;
    }

    return { status: "ok", value: { wanted: true } } as const;
  });
}

/**
 * Removes the actor's own entry. Idempotent and silent about anything else: the
 * answer is the same whether the actor had the place on the list, somebody else
 * did, or the place does not exist, so it reveals nothing.
 */
export async function removeFromWantToSee(
  actor: Actor | null,
  placeId: string,
  deps: WantToSeeDeps,
): Promise<WantToSeeOutcome<{ wanted: false }>> {
  const admitted = await admit(actor, deps, { counted: true });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isUuid(placeId)) {
    return { status: "not_found" };
  }

  return deps.withUserContext(admitted.actor, async (tx) => {
    await deps.repository.removePlace(tx, placeId);

    return { status: "ok", value: { wanted: false } } as const;
  });
}

/** "Chcę zobaczyć": the actor's places that are publicly visible now, newest save first. */
export async function listWantToSee(
  actor: Actor | null,
  deps: WantToSeeDeps,
): Promise<WantToSeeOutcome<readonly WantToSeePlace[]>> {
  const admitted = await admit(actor, deps, { counted: false });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  return deps.withUserContext(admitted.actor, async (tx) => ({
    status: "ok",
    value: await deps.repository.listPlaces(tx),
  }));
}

/** Whether the place is on the actor's list (for the place page). */
export async function isWantedPlace(
  actor: Actor | null,
  placeId: string,
  deps: WantToSeeDeps,
): Promise<WantToSeeOutcome<{ wanted: boolean }>> {
  const admitted = await admit(actor, deps, { counted: false });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isUuid(placeId)) {
    return { status: "not_found" };
  }

  return deps.withUserContext(admitted.actor, async (tx) => ({
    status: "ok",
    value: { wanted: await deps.repository.isPlaceWanted(tx, placeId) },
  }));
}
