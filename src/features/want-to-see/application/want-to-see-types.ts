import type { ActionRateLimiter } from "@/features/identity/domain/action-rate-limit";
import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

// One place on the list of the signed-in explorer. Only what the list shows: no
// user id, and no coordinates. `visited` is only whether the actor has a visit
// of their own here (so the list can mark it); never a date or a count.
export type WantToSeePlace = Readonly<{
  id: string;
  name: string;
  address: string;
  savedAt: Date;
  visited: boolean;
}>;

// All database access of the list. Every method runs inside the user context
// the use case opened, so the row policies decide what it sees or changes; no
// method takes a user id (the owner is app_current_user_id() in SQL).
export interface WantToSeeRepository {
  /** Places of the list that are publicly visible now (a withdrawn one is not listed), newest save first, at most MAX_WANT_TO_SEE_LISTED. */
  listPlaces(tx: TransactionContext): Promise<readonly WantToSeePlace[]>;
  /** True when the place is in a collection published by an approved organization (what a guest sees). */
  isPubliclyVisiblePlace(tx: TransactionContext, placeId: string): Promise<boolean>;
  /**
   * Adds the place for the actor if it is public in this very statement; a
   * repeated add changes nothing. False means the place is not public (any more).
   */
  addPlace(tx: TransactionContext, placeId: string): Promise<boolean>;
  /** Removes the actor's own entry, if any; the row of anybody else is never matched. */
  removePlace(tx: TransactionContext, placeId: string): Promise<void>;
  isPlaceWanted(tx: TransactionContext, placeId: string): Promise<boolean>;
}

export type WantToSeeDeps = Readonly<{
  withUserContext: <T>(
    actor: Pick<Actor, "id">,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  limiter: ActionRateLimiter;
  repository: WantToSeeRepository;
}>;

// The answer of every use case; a handler maps it to a status code.
export type WantToSeeOutcome<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "rate_limited"; retryAfterSeconds: number }>;
