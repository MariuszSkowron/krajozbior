import type { AlbumRepository } from "@/features/album/application/album-types";
import type { Progress } from "@/features/album/domain/progress";
import type { ActionRateLimiter } from "@/features/identity/domain/action-rate-limit";
import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import type { DatePrecision } from "../domain/past-visit-request";
import type { VISIT_KINDS } from "../domain/visit-outcome";
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
  /** The place of the actor's own visit with this client id, or null (the row policies show only their own). */
  findOwnVisitPlaceId(tx: TransactionContext, clientVisitId: string): Promise<string | null>;
  /** Whether the actor has any visit of the place (the row policies show only their own). */
  hasVisitedPlace(tx: TransactionContext, placeId: string): Promise<boolean>;
  /**
   * The kind of the actor's visit of the place (own rows only): whether there is
   * one confirmed on site, and the visit from the past with its date, if any.
   */
  getMyVisitOfPlace(tx: TransactionContext, placeId: string): Promise<MyVisitOfPlace>;
  /** For each place of the collection the actor has visited: the kind (on site wins over past). */
  listMyVisitKindsOfCollection(
    tx: TransactionContext,
    collectionId: string,
  ): Promise<readonly Readonly<{ placeId: string; kind: VisitKind }>[]>;
  /**
   * Marks the places as visited in the past, in ONE statement under an advisory
   * lock of the actor: nothing is written unless every place is publicly
   * visible (`visible` is then less than `requested`); a place the actor
   * already has a visit of (any kind) gets no new row. Returns the counts.
   */
  markPastVisits(
    tx: TransactionContext,
    placeIds: readonly string[],
    when: Readonly<{ visitedOn: string | null; precision: DatePrecision }>,
  ): Promise<Readonly<{ visible: number; recorded: number }>>;
  /** Removes the actor's own visits from the past of the place; returns how many. */
  deleteMyPastVisits(tx: TransactionContext, placeId: string): Promise<number>;
}

export type VisitKind = (typeof VISIT_KINDS)[number];

export type MyVisitOfPlace = Readonly<{
  onSite: boolean;
  past: Readonly<{ precision: DatePrecision; visitedOn: string | null }> | null;
}>;

/** The answer of a marked batch: how many places got a visit and how many already had one. */
export type PastVisitResponse = Readonly<{ recorded: number; alreadyVisited: number }>;

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
