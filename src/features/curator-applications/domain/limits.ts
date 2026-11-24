import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

// Limits of the curator applications (spec "Rola kuratora", 5.3). They are limits of the
// application, not of the database: raw SQL as krajozbior_app is not bound by them. The storage of
// `ActionRateLimiter` keeps windows of at most 15 minutes (`SIGN_IN_WINDOW_SECONDS`), so the daily
// and hourly limits of the spec are expressed in 15-minute windows (about the same hourly rate).
// The hard caps are in the database: 20 rows per account and one pending application.

/** Applications an account may keep (restrictive INSERT policy of the migration). */
export const MAX_APPLICATIONS_PER_ACCOUNT = 20;
/** Rows the administrator's list returns at most (D-25). */
export const MAX_LISTED_APPLICATIONS = 200;

/** A new application: 5 per window of 15 minutes, per applicant. */
export const CURATOR_APPLICATION_SUBMIT_ACTION = "curator_application_submit";
export const curatorApplicationSubmitLimit: ActionLimit = { limit: 5, windowSeconds: 15 * 60 };

/** Withdrawing or removing an own application: 10 per window of 15 minutes. */
export const CURATOR_APPLICATION_WITHDRAW_ACTION = "curator_application_withdraw";
export const curatorApplicationWithdrawLimit: ActionLimit = { limit: 10, windowSeconds: 15 * 60 };

/** Approvals by one administrator: 3 per window of 15 minutes (about 12 per hour). */
export const CURATOR_APPLICATION_APPROVE_ACTION = "curator_application_approve";
export const curatorApplicationApproveLimit: ActionLimit = { limit: 3, windowSeconds: 15 * 60 };

/** All decisions and revocations of one administrator: 5 per 15 minutes (about 20 per hour). */
export const CURATOR_APPLICATION_DECIDE_ACTION = "curator_application_decide";
export const curatorApplicationDecideLimit: ActionLimit = { limit: 5, windowSeconds: 15 * 60 };
