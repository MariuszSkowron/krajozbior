import type { Region } from "@/features/catalog/domain/collection";
import type { ActionRateLimiter } from "@/features/identity/domain/action-rate-limit";
import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import type { HomeRecentVisit } from "../domain/home-album";
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

// The home page of the explorer (E12-1). Counts only; no user id.
export type HomeSummary = Readonly<{
  /** Different places with an own visit of any kind, also places no longer in a public collection (R-07). */
  discoveredPlaces: number;
  /** Voivodeships of the public collections that hold a visited place. */
  regions: number;
  /** Saved collections that are public now (the same set as "Moje kolekcje"). */
  savedCollections: number;
}>;

// A favourite collection as the repository reads it: the counts the progress is made of.
export type HomeFavoriteRow = Readonly<{
  id: string;
  slug: string;
  title: string;
  region: Region;
  total: number;
  visited: number;
}>;

export type HomeAlbum = Readonly<{
  summary: HomeSummary;
  favorites: readonly SavedCollectionSummary[];
  recentVisits: readonly HomeRecentVisit[];
}>;

export type CollectionPlaceLink = Readonly<{ collectionId: string; placeId: string }>;

export type CollectionProgressView = Readonly<{ saved: boolean; progress: Progress }>;

export type SaveCollectionResult = "saved" | "not_found" | "too_many";

// All database access of the album. Every method runs inside the user context
// the use case opened, so the row policies decide what it sees or changes; no
// method takes a user id (the owner is app_current_user_id() in SQL).
export interface AlbumRepository {
  /** Saved collections that are published now (a withdrawn one is not listed), newest save first, at most MAX_COLLECTIONS_PER_LIST. */
  listSavedCollections(tx: TransactionContext): Promise<readonly SavedCollectionRow[]>;
  /** The places of the collections of listSavedCollections (the same newest MAX_COLLECTIONS_PER_LIST), in collection order. */
  listSavedCollectionPlaces(tx: TransactionContext): Promise<readonly CollectionPlaceLink[]>;
  /** Ids of the places visited by the actor that belong to the collections of listSavedCollections, at most MAX_PROGRESS_PLACES. */
  listVisitedPlaceIds(tx: TransactionContext): Promise<readonly string[]>;
  /** True when the collection is published by an approved organization (what a guest sees). */
  isPubliclyVisibleCollection(tx: TransactionContext, collectionId: string): Promise<boolean>;
  /**
   * Saves the collection for the actor if it is public in this very statement; a
   * repeated save changes nothing. `not_found`: the collection is not public (any
   * more). `too_many`: the actor already has MAX_COLLECTIONS_PER_LIST collections on
   * the list, own (E8-1a) and saved ones together (D-28, [P-E8-A3]). The count is taken under a lock of
   * the actor, so two simultaneous saves cannot both take the last place.
   */
  saveCollection(tx: TransactionContext, collectionId: string): Promise<SaveCollectionResult>;
  /** Removes the actor's save, if any; the row of anybody else is never matched. */
  unsaveCollection(tx: TransactionContext, collectionId: string): Promise<void>;
  isCollectionSaved(tx: TransactionContext, collectionId: string): Promise<boolean>;
  /**
   * The three counts of the home page, each with the public filter spelled out
   * (published collection, approved organization), whatever the actor's role.
   */
  homeSummary(tx: TransactionContext): Promise<HomeSummary>;
  /**
   * Saved public collections, most recently used first (the later of the save and
   * the last own visit in one of its places), at most `limit`, with the counts of
   * the progress.
   */
  homeFavorites(tx: TransactionContext, limit: number): Promise<readonly HomeFavoriteRow[]>;
  /**
   * The actor's `limit` latest visits, newest first. The place is joined only when
   * it is in a public collection; otherwise `place` is null.
   */
  homeRecentVisits(tx: TransactionContext, limit: number): Promise<readonly HomeRecentVisit[]>;
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
  | Readonly<{ status: "conflict"; reason: "too_many_saved" }>
  | Readonly<{ status: "rate_limited"; retryAfterSeconds: number }>;
