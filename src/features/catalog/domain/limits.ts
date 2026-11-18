import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

// Abuse limits of the curator write routes (D-T9). Starting values, changeable
// without a decision of the owner.
export const CURATOR_WRITE_ACTION = "curator_write";
export const curatorWriteLimit: ActionLimit = { limit: 120, windowSeconds: 10 * 60 };

// Upper bounds on rows (D-25): a list of collections shows at most 200 of them,
// and one collection holds at most 500 places. Far above real use; they only
// stop a runaway account from making every page and progress count expensive.
export const MAX_COLLECTIONS_PER_LIST = 200;
export const MAX_PLACES_PER_COLLECTION = 500;

/** Largest request body of a curator route; bigger gets 413. */
export const CURATOR_BODY_MAX_BYTES = 16 * 1024;
