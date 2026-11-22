import type { ActionRateLimiter } from "@/features/identity/domain/action-rate-limit";
import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import type { EntryState } from "../domain/entry";
import type { OwnCollectionField, OwnCollectionInput, OwnRegion } from "../domain/own-collection";

// What the explorer sees of an own collection. No owner id: the owner is always the actor.
export type OwnCollectionRow = Readonly<{
  id: string;
  title: string;
  summary: string;
  region: OwnRegion;
  version: number;
}>;

/** A row of "Moje kolekcje": the collection and the counts of its progress (X of Y, R-06). */
export type OwnCollectionSummary = Readonly<OwnCollectionRow & { visited: number; total: number }>;

/** What the repository reads of an entry; the use case adds the state. */
export type OwnEntryRow = Readonly<{
  id: string;
  position: number;
  /** Null once the curator deleted the place. */
  placeId: string | null;
  /** The public name from the moment the place was added. */
  nameSnapshot: string;
  /** Present only while the place is public now. */
  place: Readonly<{ name: string; address: string }> | null;
  visited: boolean;
}>;

export type OwnEntry = Readonly<OwnEntryRow & { state: EntryState }>;

export type OwnCollectionDetail = Readonly<{
  collection: OwnCollectionRow;
  entries: readonly OwnEntry[];
  /** Entries that count (the place is public now) and those with an own visit. */
  progress: Readonly<{ visited: number; total: number }>;
}>;

export type CreateOwnCollectionResult =
  | Readonly<{ status: "created"; id: string }>
  | Readonly<{ status: "too_many_own_collections" }>
  | Readonly<{ status: "my_collections_full" }>;

export type UpdateOwnCollectionResult = "updated" | "stale_version" | "not_found";

export type AddEntryResult = "added" | "already_there" | "not_found" | "too_many_items";

// All database access of the own collections. Every method runs inside the user context the use
// case opened, so the row policies decide what it sees or changes; no method takes a user id (the
// owner is app_current_user_id() in SQL).
export interface OwnCollectionsRepository {
  /** The actor's own collections, newest first, at most MAX_OWN_COLLECTIONS, with the progress counts. */
  listOwn(tx: TransactionContext): Promise<readonly OwnCollectionSummary[]>;
  /** One own collection; another person's id gives `null`, the same as a missing one. */
  findOwn(tx: TransactionContext, id: string): Promise<OwnCollectionRow | null>;
  /** Entries in order, at most MAX_ITEMS_PER_OWN_COLLECTION. */
  listEntries(tx: TransactionContext, collectionId: string): Promise<readonly OwnEntryRow[]>;
  /**
   * Creates the collection under the lock of the actor (the same key as saving a collection of a
   * curator), so the limit of 50 own and of 200 own and saved together cannot be exceeded by two
   * simultaneous writes (D-28, [P-E8-A3]).
   */
  create(tx: TransactionContext, input: OwnCollectionInput): Promise<CreateOwnCollectionResult>;
  /** Changes the text of the collection when `version` is still the current one. */
  update(
    tx: TransactionContext,
    id: string,
    version: number,
    input: OwnCollectionInput,
  ): Promise<UpdateOwnCollectionResult>;
  /** Deletes the collection with its entries; false when it is not the actor's. */
  remove(tx: TransactionContext, id: string): Promise<boolean>;
  /**
   * Adds a place that is public now. `not_found`: the collection is not the actor's or the place
   * is not public (a draft, a withdrawn collection, a suspended organization, a missing id). A
   * repeated add changes nothing. The count is taken under a lock of the collection.
   */
  addPlace(tx: TransactionContext, collectionId: string, placeId: string): Promise<AddEntryResult>;
  /** Removes one entry of the actor's collection; false when there is none. */
  removeEntry(tx: TransactionContext, collectionId: string, entryId: string): Promise<boolean>;
}

export type OwnCollectionsDeps = Readonly<{
  withUserContext: <T>(
    actor: Pick<Actor, "id">,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  limiter: ActionRateLimiter;
  repository: OwnCollectionsRepository;
}>;

export type OwnCollectionsConflict =
  "too_many_own_collections" | "my_collections_full" | "stale_version" | "too_many_items";

// The answer of every use case; a handler maps it to a status code.
export type OwnCollectionsOutcome<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "invalid"; errors: readonly (OwnCollectionField | "placeId" | "itemId")[] }>
  | Readonly<{ status: "conflict"; reason: OwnCollectionsConflict }>
  | Readonly<{ status: "rate_limited"; retryAfterSeconds: number }>;
