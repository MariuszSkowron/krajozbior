import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

// Frozen limits of the news domain (spec E7, D-E7-1, D-E7-3, D-E7-7). The database
// repeats the length limits in CHECK constraints (E7-1a), counted in characters
// (code points), so the domain counts code points too.
export const NEWS_TITLE_MIN_LENGTH = 5;
export const NEWS_TITLE_MAX_LENGTH = 120;
export const NEWS_LEAD_MIN_LENGTH = 1;
export const NEWS_LEAD_MAX_LENGTH = 280;
export const NEWS_BODY_MAX_LENGTH = 5000;
export const NEWS_HIDDEN_REASON_MIN_LENGTH = 10;
export const NEWS_HIDDEN_REASON_MAX_LENGTH = 400;

// The dates of an event (S3): PostgreSQL has no year 0, and a year far from today is a
// slip of the curator. The `CHECK` of E7-1a repeats this exact range.
export const NEWS_EVENT_MIN_DATE = "2000-01-01";
export const NEWS_EVENT_MAX_DATE = "2100-12-31";

// Q18: at most this many links in one news body.
export const NEWS_MAX_LINKS = 5;

// D-E7-7: the three publication limits of one organization.
export const MAX_NEWS_PUBLISHED_PER_DAY = 20;
export const MAX_NEWS_PER_ORGANIZATION = 200;
export const NEWS_PUBLISH_ACTION = "news_publish";
// A window of 15 minutes is the longest the action limiter allows.
export const newsPublishLimit: ActionLimit = { limit: 10, windowSeconds: 15 * 60 };

// Q13: a withdrawn news item may be deleted only this long after the withdrawal.
export const NEWS_DELETE_AFTER_WITHDRAWAL_DAYS = 14;

// D-E7-9: "Zaktualizowano" shows only when the content changed later than this
// after the publication, so a typo fixed right after publishing does not count.
export const NEWS_UPDATED_NOTE_MINUTES = 10;
