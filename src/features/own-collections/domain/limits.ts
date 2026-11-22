import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

// Limits of the private collections of an explorer (E8-Q9, D-25, D-28). Starting values, except
// the three row limits, which the owner accepted on 2026-11-19.

/** An explorer owns at most this many collections. */
export const MAX_OWN_COLLECTIONS = 50;
/** "Moje kolekcje" lists at most this many collections: own and saved ones together ([P-E8-A3]). */
export const MAX_MY_COLLECTIONS = 200;
/** One own collection holds at most this many places (fewer than the 500 of a curator). */
export const MAX_ITEMS_PER_OWN_COLLECTION = 200;

/** Writes of own collections and their entries, per user: 60 in a window of 10 minutes (E8-Q9). */
export const OWN_COLLECTION_WRITE_ACTION = "own_collection_write";
export const ownCollectionWriteLimit: ActionLimit = { limit: 60, windowSeconds: 10 * 60 };

/** Largest body of a write route: a title, a summary and a region, or one id. */
export const OWN_COLLECTION_BODY_MAX_BYTES = 4 * 1024;

/** The place search on the page of a collection lists at most this many hits. */
export const OWN_COLLECTION_SEARCH_LIMIT = 20;
