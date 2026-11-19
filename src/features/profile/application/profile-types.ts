import type { ActionRateLimiter } from "@/features/identity/domain/action-rate-limit";
import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import type { Profile, ProfileField } from "../domain/profile";

// All database access of the profile. Every method runs inside the user context
// the use case opened, so the row policies decide what it sees or changes; no
// method takes a user id (the owner is app_current_user_id() in SQL).
export interface ProfileRepository {
  /** The actor's own profile, or `null` when it was never saved (the defaults apply). */
  read(tx: TransactionContext): Promise<Profile | null>;
  /** Creates or replaces the actor's own profile and returns what is stored. */
  save(tx: TransactionContext, profile: Profile): Promise<Profile>;
}

export type ProfileDeps = Readonly<{
  withUserContext: <T>(
    actor: Pick<Actor, "id">,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  limiter: ActionRateLimiter;
  repository: ProfileRepository;
}>;

// The answer of every use case; a handler maps it to a status code.
export type ProfileOutcome<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "invalid"; fields: readonly ProfileField[] }>
  | Readonly<{ status: "rate_limited"; retryAfterSeconds: number }>;
