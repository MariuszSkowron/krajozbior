// Sign-in attempt limits (issue #39). Better Auth's own limiter only runs in
// its HTTP router, which is not mounted, so the login route asks this port
// before checking a password.
//
// Three buckets per attempt, all in one fixed 15-minute window:
// - account + IP: the strict limit, so a stranger cannot lock a victim out;
// - IP: one address guessing across many accounts;
// - account: a distributed attack on one account.
// Without a known client IP the account + IP bucket uses "unknown", so locally
// (no proxy) the strict limit applies per account.
export const SIGN_IN_WINDOW_SECONDS = 15 * 60;

export const signInLimits = { accountIp: 5, ip: 20, account: 50 } as const;

export type ThrottleScope = keyof typeof signInLimits;

export type ThrottleSubject = { email: string; ip: string | null };

export type ThrottleDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface SignInThrottle {
  // Counts an attempt in every bucket when all of them have room; otherwise
  // counts nothing and says when to retry.
  reserve(subject: ThrottleSubject): Promise<ThrottleDecision>;
  // After a successful sign-in: resets the account's buckets, not the IP's.
  clearAccount(subject: ThrottleSubject): Promise<void>;
}

export type BucketState = {
  scope: ThrottleScope;
  attempts: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
};

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

// Pure decision over the buckets' stored state at `now`. A manual block wins
// over the counters; an expired window counts as empty.
export function decide(buckets: readonly BucketState[], now: Date): ThrottleDecision {
  const windowMs = SIGN_IN_WINDOW_SECONDS * 1000;
  let retryAfterMs = 0;

  for (const bucket of buckets) {
    if (bucket.lockedUntil !== null && bucket.lockedUntil > now) {
      retryAfterMs = Math.max(retryAfterMs, bucket.lockedUntil.getTime() - now.getTime());
      continue;
    }

    const windowEnd = bucket.windowStartedAt.getTime() + windowMs;

    if (windowEnd > now.getTime() && bucket.attempts >= signInLimits[bucket.scope]) {
      retryAfterMs = Math.max(retryAfterMs, windowEnd - now.getTime());
    }
  }

  return retryAfterMs > 0
    ? { allowed: false, retryAfterSeconds: seconds(retryAfterMs) }
    : { allowed: true };
}

// The email the account buckets are keyed on; the same for any spelling of it.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
