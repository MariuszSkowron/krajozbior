import {
  AuthenticationRequiredError,
  requireActor,
  type Actor,
} from "@/features/identity/domain/actor";

import { PROFILE_WRITE_ACTION, profileWriteLimit } from "../domain/limits";
import { DEFAULT_PROFILE, parseProfileInput, type Profile } from "../domain/profile";
import type { ProfileDeps, ProfileOutcome } from "./profile-types";

// The profile of the explorer (E9-2). Every use case takes the actor from the
// session and never a user id: the owner of the row is app_current_user_id() in
// the database, and the row policies are the second barrier. A guest gets
// `unauthenticated` before anything else happens.

/** The actor's own profile; without a saved row the defaults (private, no name). */
export async function getMyProfile(
  actor: Actor | null,
  deps: ProfileDeps,
): Promise<ProfileOutcome<Profile>> {
  let signedIn: Actor;

  try {
    signedIn = requireActor(actor);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { status: "unauthenticated" };
    }
    throw error;
  }

  return deps.withUserContext(signedIn, async (tx) => ({
    status: "ok",
    value: (await deps.repository.read(tx)) ?? DEFAULT_PROFILE,
  }));
}

/**
 * Saves the actor's own profile (a full replacement of the four fields). The
 * body is validated after the session and the limit, so a guest gets 401 whatever
 * the body is and a bad body never reaches the database.
 */
export async function saveMyProfile(
  actor: Actor | null,
  body: unknown,
  deps: ProfileDeps,
): Promise<ProfileOutcome<Profile>> {
  let signedIn: Actor;

  try {
    signedIn = requireActor(actor);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { status: "unauthenticated" };
    }
    throw error;
  }

  const decision = await deps.limiter.reserve(PROFILE_WRITE_ACTION, signedIn.id, profileWriteLimit);

  if (!decision.allowed) {
    return { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds };
  }

  const parsed = parseProfileInput(body);

  if (!parsed.ok) {
    return { status: "invalid", fields: parsed.fields };
  }

  return deps.withUserContext(signedIn, async (tx) => ({
    status: "ok",
    value: await deps.repository.save(tx, parsed.value),
  }));
}
