import {
  MAX_COLLECTIONS_PER_LIST,
  MAX_PLACES_PER_COLLECTION,
} from "@/features/catalog/domain/limits";
import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

// Abuse limit of the explorer's album writes (saving and unsaving a
// collection), counted per user. A starting value, changeable without a
// decision of the owner.
// Upper bound on the visited places read for the progress of the album: the
// places of the listed collections, which are at most MAX_COLLECTIONS_PER_LIST
// collections of at most MAX_PLACES_PER_COLLECTION places each (D-25, D-28).
export const MAX_PROGRESS_PLACES = MAX_COLLECTIONS_PER_LIST * MAX_PLACES_PER_COLLECTION;

export const ALBUM_WRITE_ACTION = "album_write";
export const albumWriteLimit: ActionLimit = { limit: 120, windowSeconds: 10 * 60 };
