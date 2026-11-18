import type { Region } from "@/features/catalog/domain/collection";
import type { ActionRateLimiter } from "@/features/identity/domain/action-rate-limit";
import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import type { Progress } from "../domain/progress";

// One saved collection of the signed-in explorer, with the progress computed by
// the domain rule. No user id and no visit date: only counts leave the album.
export type SavedCollectionSummary = Readonly<{
  id: string;
  slug: string;
  title: string;
  region: Region;
  progress: Progress;
}>;

// Raw rows the repository reads in the context of the actor; the use case turns
// them into progress, so the counting rule lives in one place (domain/progress).
export type SavedCollectionRow = Readonly<{
  id: string;
  slug: string;
  title: string;
  region: Region;
}>;

export type CollectionPlaceLink = Readonly<{ collectionId: string; placeId: string }>;

export type CollectionProgressView = Readonly<{ saved: boolean; progress: Progress }>;

// All database access of the album. Every method runs inside the user context
// the use case opened, so the row policies decide what it sees or changes; no
// method takes a user id (the owner is app_current_user_id() in SQL).
export interface AlbumRepository {
  /** Saved collections that are published now (a withdrawn one is not listed), newest save first, at most MAX_COLLECTIONS_PER_LIST. */
  listSavedCollections(tx: TransactionContext): Promise<readonly SavedCollectionRow[]>;
  /** The places of the saved, published collections, in collection order. */
  listSavedCollectionPlaces(tx: TransactionContext): Promise<readonly CollectionPlaceLink[]>;
  /** Ids of the places visited by the actor that belong to a saved collection. */
  listVisitedPlaceIds(tx: TransactionContext): Promise<readonly string[]>;
  /** True when the collection is published by an approved organization (what a guest sees). */
  isPubliclyVisibleCollection(tx: TransactionContext, collectionId: string): Promise<boolean>;
  /**
   * Saves the collection for the actor if it is public in this very statement; a
   * repeated save changes nothing. False means the collection is not public (any more).
   */
  saveCollection(tx: TransactionContext, collectionId: string): Promise<boolean>;
  /** Removes the actor's save, if any; the row of anybody else is never matched. */
  unsaveCollection(tx: TransactionContext, collectionId: string): Promise<void>;
  isCollectionSaved(tx: TransactionContext, collectionId: string): Promise<boolean>;
  listPlaceIdsOfCollection(
    tx: TransactionContext,
    collectionId: string,
  ): Promise<readonly string[]>;
  /** Places of the collection the actor has visited at least once. */
  listVisitedPlaceIdsOfCollection(
    tx: TransactionContext,
    collectionId: string,
  ): Promise<readonly string[]>;
}

export type AlbumDeps = Readonly<{
  withUserContext: <T>(
    actor: Pick<Actor, "id">,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  limiter: ActionRateLimiter;
  repository: AlbumRepository;
}>;

// The answer of every album use case; a handler maps it to a status code.
export type AlbumOutcome<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "rate_limited"; retryAfterSeconds: number }>;
