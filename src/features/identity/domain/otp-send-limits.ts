// Limits of sign-in code requests. Every request that passes the format check
// is counted the same way, whatever the address: an existing account, a new
// one or an admin account (which never gets a code). The role decides only
// whether a message goes out, never the answer or the counters, so the limits
// reveal nothing about which addresses belong to admins.
//
// These counters are separate from the password sign-in limits
// (sign-in-throttle.ts): asking for codes to an admin's address never uses up
// that admin's password attempts.
//
// Address buckets use the normalized limit key (email-limit-key.ts). Without a
// known client IP the "address from one IP" buckets count under "unknown" and
// there is no IP bucket (local work without a proxy).
export const OTP_SEND_WINDOW_SECONDS = 15 * 60;

export const otpSendLimits = {
  // 15-minute windows (rows in auth.sign_in_throttle, prefix `otp_send:`).
  window: { emailIp: 3, email: 5, ip: 10 },
  // UTC days (rows in auth.otp_send_counters).
  // ip: 100 per day, so a class, a mobile network or a jury in one room can
  // sign in from one address (D-62); the address and the global limits stay.
  daily: { emailIp: 10, email: 20, ip: 100 },
} as const;

// The global daily limit of accepted requests comes from configuration
// (OTP_GLOBAL_DAILY_LIMIT, 250 by default). An alarm is logged at 80% and 100%.
export const DEFAULT_OTP_GLOBAL_DAILY_LIMIT = 250;
const GLOBAL_ALARM_RATIO = 0.8;

export type OtpSendScope = keyof typeof otpSendLimits.window;

export type OtpSendSubject = { email: string; ip: string | null };

export type OtpWindowBucket = {
  scope: OtpSendScope;
  attempts: number;
  windowStartedAt: Date;
  // A manual block by the operator.
  lockedUntil: Date | null;
};

export type OtpDailyBucket = { scope: OtpSendScope | "global"; count: number };

export type OtpSendDecision =
  | { allowed: true }
  // `rate`: a 15-minute limit of the address or the IP (429); `daily`: a daily
  // limit of the address or the IP (429, the wait lasts to UTC midnight);
  // `global`: the daily limit of the application (503, the same answer for
  // everybody). Which limit was hit depends only on the counters, never on
  // whether the address has an account, so the kind may be shown to the person.
  | { allowed: false; reason: "rate" | "daily" | "global"; retryAfterSeconds: number };

export interface OtpSendLimiter {
  // Counts the request in every bucket when all of them have room; otherwise
  // counts nothing and says why and when to retry. Throws on a database failure.
  reserve(subject: OtpSendSubject): Promise<OtpSendDecision>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

// Time left until the next UTC midnight, when the daily counters start anew.
export function msUntilNextUtcDay(now: Date): number {
  return DAY_MS - (now.getTime() % DAY_MS);
}

export type OtpSendState = Readonly<{
  window: readonly OtpWindowBucket[];
  daily: readonly OtpDailyBucket[];
  globalLimit: number;
  now: Date;
}>;

// Pure decision over the stored state of the request's buckets at `now`. The
// global limit wins: when it is reached, every address gets the same answer.
export function decideOtpSend(state: OtpSendState): OtpSendDecision {
  const { now } = state;
  const untilTomorrow = msUntilNextUtcDay(now);

  if (state.daily.some(({ scope, count }) => scope === "global" && count >= state.globalLimit)) {
    return { allowed: false, reason: "global", retryAfterSeconds: seconds(untilTomorrow) };
  }

  const windowMs = OTP_SEND_WINDOW_SECONDS * 1000;
  let retryAfterMs = 0;

  for (const bucket of state.window) {
    if (bucket.lockedUntil !== null && bucket.lockedUntil > now) {
      retryAfterMs = Math.max(retryAfterMs, bucket.lockedUntil.getTime() - now.getTime());
      continue;
    }

    const windowEnd = bucket.windowStartedAt.getTime() + windowMs;

    if (windowEnd > now.getTime() && bucket.attempts >= otpSendLimits.window[bucket.scope]) {
      retryAfterMs = Math.max(retryAfterMs, windowEnd - now.getTime());
    }
  }

  let dailyFull = false;

  for (const { scope, count } of state.daily) {
    if (scope !== "global" && count >= otpSendLimits.daily[scope]) {
      dailyFull = true;
      retryAfterMs = Math.max(retryAfterMs, untilTomorrow);
    }
  }

  return retryAfterMs > 0
    ? {
        allowed: false,
        reason: dailyFull ? "daily" : "rate",
        retryAfterSeconds: seconds(retryAfterMs),
      }
    : { allowed: true };
}

// The alarm to log after the global counter reached `count`: once when it
// crosses 80% of the limit and once when it reaches the limit.
export function globalLimitAlarm(count: number, limit: number): "80" | "100" | null {
  if (count === limit) {
    return "100";
  }

  return count === Math.ceil(limit * GLOBAL_ALARM_RATIO) ? "80" : null;
}
