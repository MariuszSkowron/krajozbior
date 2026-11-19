import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

// Abuse limit of saving the profile, counted per user: 30 per 10 minutes. A
// starting value, changeable without a decision of the owner.
export const PROFILE_WRITE_ACTION = "profile_write";
export const profileWriteLimit: ActionLimit = { limit: 30, windowSeconds: 10 * 60 };

// The body of a profile save is a few short fields; anything bigger is refused.
export const PROFILE_BODY_MAX_BYTES = 2048;
