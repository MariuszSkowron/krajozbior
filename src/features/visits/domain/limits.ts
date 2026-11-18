import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

// Abuse limit of confirming a visit on site (spec D-T9): 20 attempts per 10
// minutes per user. A starting value, changeable without a decision of the
// owner. The body of the request is tiny (four numbers and an id): 16 KB.
export const VISIT_ACTION = "visit_on_site";
export const visitLimit: ActionLimit = { limit: 20, windowSeconds: 10 * 60 };
export const VISIT_BODY_MAX_BYTES = 16 * 1024;

// Marking visits from the past (spec D-T9, D-10): up to 100 places per request.
// One action for the batch and the single mark from a place page, so 30 requests
// per 10 minutes (a starting value). The number of rows is bounded by the rule
// "one past visit per place", not by this limit. The body is up to 64 KB.
export const PAST_VISIT_ACTION = "visit_past";
export const pastVisitLimit: ActionLimit = { limit: 30, windowSeconds: 10 * 60 };
export const PAST_VISIT_BODY_MAX_BYTES = 64 * 1024;
export const MAX_PAST_VISITS_PER_REQUEST = 100;
