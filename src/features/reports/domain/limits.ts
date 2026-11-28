import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

// Limits of sending a report of a problem with a place (P4b, PR B; D-E5-8). The three counts are
// enforced by triggers of the database (`Migration20261128030000_place_reports_limits`); they are
// repeated here only for messages, and tests/integration/place-reports-limits.test.ts compares
// them with the functions. The burst limit is a request limit per user like the other actions.

/** Reports one person may send in 24 hours (decided ones count too). */
export const DAILY_REPORT_LIMIT = 10;
/** Open reports one person may have at the same time. */
export const OPEN_REPORTS_PER_AUTHOR_LIMIT = 50;
/** Open reports one place may hold from all authors at once ([P], a single constant). */
export const OPEN_REPORTS_PER_PLACE_LIMIT = 20;

export const REPORT_ACTION = "report";
/** Protection against a series: 5 sends in 10 minutes. */
export const reportSubmitLimit: ActionLimit = { limit: 5, windowSeconds: 10 * 60 };

/** Largest body of the route that sends a report; bigger gets 413. */
export const REPORT_BODY_MAX_BYTES = 8 * 1024;
/** The description is at most this many characters (counted after CRLF -> LF). */
export const REPORT_MESSAGE_MAX_LENGTH = 1000;
