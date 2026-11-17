import { SIGN_IN_WINDOW_SECONDS, type ThrottleDecision } from "./sign-in-throttle";

// Request limits of authenticated actions (e.g. saving a record), per user.
// They share the storage of the sign-in limiter (`auth.sign_in_throttle`),
// whose cleanup removes rows whose window ended more than
// SIGN_IN_WINDOW_SECONDS ago, so a window here may not be longer than that.
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
    windowSeconds > SIGN_IN_WINDOW_SECONDS
  ) {
    throw new RangeError(`Window must be between 1 and ${SIGN_IN_WINDOW_SECONDS} seconds.`);
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
