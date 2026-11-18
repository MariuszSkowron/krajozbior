import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

// The list holds at most this many places and shows them newest first; a new one
// is refused with 409, not hidden (D-25, D-28).
export const MAX_WANT_TO_SEE_LISTED = 200;

// Abuse limit of adding and removing places on the "Chcę zobaczyć" list, counted
// per user (spec D-T9: 60 per 10 minutes). A starting value, changeable without
// a decision of the owner.
export const WANT_TO_SEE_WRITE_ACTION = "want_to_see_write";
export const wantToSeeWriteLimit: ActionLimit = { limit: 60, windowSeconds: 10 * 60 };
