import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

// Abuse limits of the curator write routes (D-T9). Starting values, changeable
// without a decision of the owner.
export const CURATOR_WRITE_ACTION = "curator_write";
export const curatorWriteLimit: ActionLimit = { limit: 120, windowSeconds: 10 * 60 };

/** Largest request body of a curator route; bigger gets 413. */
export const CURATOR_BODY_MAX_BYTES = 16 * 1024;
