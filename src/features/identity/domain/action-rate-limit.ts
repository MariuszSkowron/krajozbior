import type { ThrottleDecision } from "./sign-in-throttle";

// Request limits of authenticated actions (e.g. saving a record), per user.
// They share the storage of the sign-in limiter (`auth.sign_in_throttle`).
// Its cleanup keeps the rows of the keys starting with ACTION_KEY_PREFIX for
// MAX_ACTION_WINDOW_SECONDS (the sign-in rows for their own, shorter window),
// so a window here may not be longer than that.
export const ACTION_KEY_PREFIX = "action:";
export const MAX_ACTION_WINDOW_SECONDS = 24 * 60 * 60;
// Each action defines its own limit next to its use case:
//   export const saveNoteLimit: ActionLimit = { limit: 30, windowSeconds: 10 * 60 };
export type ActionLimit = Readonly<{ limit: number; windowSeconds: number }>;

export function assertValidLimit({ limit, windowSeconds }: ActionLimit): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Limit must be a positive integer.");
  }

  if (
    !Number.isInteger(windowSeconds) ||
    windowSeconds < 1 ||
    windowSeconds > MAX_ACTION_WINDOW_SECONDS
  ) {
    throw new RangeError(`Window must be between 1 and ${MAX_ACTION_WINDOW_SECONDS} seconds.`);
  }
}

export interface ActionRateLimiter {
  // Counts one request of `subject` (a user id) in the named action's window.
  reserve(action: string, subject: string, limit: ActionLimit): Promise<ThrottleDecision>;
}

// Pure decision over the counter after counting this request: `attempts` in
// the window that started `elapsedMs` ago.
export function decideAction(
  attempts: number,
  elapsedMs: number,
  { limit, windowSeconds }: ActionLimit,
): ThrottleDecision {
  if (attempts <= limit) {
    return { allowed: true };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((windowSeconds * 1000 - elapsedMs) / 1000)),
  };
}
