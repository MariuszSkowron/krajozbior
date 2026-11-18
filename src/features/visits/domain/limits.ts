import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

// Abuse limit of confirming a visit on site (spec D-T9): 20 attempts per 10
// minutes per user. A starting value, changeable without a decision of the
// owner. The body of the request is tiny (four numbers and an id): 16 KB.
export const VISIT_ACTION = "visit_on_site";
export const visitLimit: ActionLimit = { limit: 20, windowSeconds: 10 * 60 };
export const VISIT_BODY_MAX_BYTES = 16 * 1024;
