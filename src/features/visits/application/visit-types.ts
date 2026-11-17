import type { AlbumRepository } from "@/features/album/application/album-types";
import type { Progress } from "@/features/album/domain/progress";
import type { ActionRateLimiter } from "@/features/identity/domain/action-rate-limit";
import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import type { VisitRequest } from "../domain/visit-request";

// The row record_on_site_visit() returns (spec D-T3).
export type VisitFunctionRow = Readonly<{ result: string; distance_m: number | null }>;

export interface VisitRepository {
  /** Calls record_on_site_visit(): the database alone decides about distance and accuracy. */
  recordOnSiteVisit(
    tx: TransactionContext,
    placeId: string,
    request: VisitRequest,
  ): Promise<VisitFunctionRow>;
  /** Whether the actor has any visit of the place (the row policies show only their own). */
  hasVisitedPlace(tx: TransactionContext, placeId: string): Promise<boolean>;
}

export type VisitDeps = Readonly<{
  withUserContext: <T>(
    actor: Pick<Actor, "id">,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  limiter: ActionRateLimiter;
  repository: VisitRepository;
  /** Read side of the album: the progress shown after a recorded visit. */
  album: Pick<
    AlbumRepository,
    "listSavedCollections" | "listSavedCollectionPlaces" | "listVisitedPlaceIds"
  >;
}>;

/** What the explorer gets back. Never the position, and no distance for a recorded visit. */
export type VisitResponse =
  | Readonly<{
      result: "recorded";
      collections: readonly Readonly<{ slug: string; title: string; progress: Progress }>[];
    }>
  | Readonly<{ result: "out_of_range"; distanceM: number }>
  | Readonly<{ result: "inaccurate"; accuracyM: number }>;

export type VisitUseCaseOutcome<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "rate_limited"; retryAfterSeconds: number }>;
