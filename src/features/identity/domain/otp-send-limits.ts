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
  window: { emailIp: 3, email: 5, ip: 30 },
  // UTC days (rows in auth.otp_send_counters).
  daily: { emailIp: 10, email: 20, ip: 30 },
} as const;

// Codes that actually go out per UTC day come from configuration. The total
// (OTP_GLOBAL_DAILY_LIMIT, 250 by default) is split into two disjoint pools:
// addresses that have an account and new addresses (OTP_NEW_ACCOUNT_DAILY_LIMIT,
// 100 by default; the accounts get the rest). A full pool never refuses a
// request: the answer stays the same and only the message is skipped, because
// any visible effect of a pool state would tell whether an address has an
// account. An alarm is logged for each pool at 80% and 100%.
export const DEFAULT_OTP_GLOBAL_DAILY_LIMIT = 250;
export const DEFAULT_OTP_NEW_ACCOUNT_DAILY_LIMIT = 100;
// A new address gets a code only while fewer requests than this came from its
// IP today. It reads the daily IP counter, which grows for every accepted
// request whatever the address, so it reveals nothing about accounts.
export const NEW_ACCOUNTS_PER_IP_DAILY = 30;
// Codes sent to one mailbox per UTC day; more are skipped silently (the limit
// of requests per address, 20, still answers 429 from there).
export const SENT_PER_EMAIL_DAILY = 5;
const GLOBAL_ALARM_RATIO = 0.8;

export type OtpSendScope = keyof typeof otpSendLimits.window;

export type OtpSendSubject = { email: string; ip: string | null };

export type OtpPools = {
  // One shared pool (`global`) when the new-address share is not smaller than the total.
  shared: boolean;
  accounts: number;
  newAccounts: number;
};

export function otpPools(globalLimit: number, newAccountLimit: number): OtpPools {
  const shared = newAccountLimit >= globalLimit;

  return {
    shared,
    accounts: shared ? globalLimit : globalLimit - newAccountLimit,
    newAccounts: shared ? globalLimit : newAccountLimit,
  };
}

export type OtpWindowBucket = {
  scope: OtpSendScope;
  attempts: number;
  windowStartedAt: Date;
  // A manual block by the operator.
  lockedUntil: Date | null;
};

// `global` is the sum of codes sent (and the shared pool); `accounts`,
// `newAccounts` are the two pools; `sentEmail` counts codes sent to one mailbox.
export type OtpPoolScope = "global" | "accounts" | "newAccounts" | "sentEmail";
export type OtpDailyBucket = { scope: OtpSendScope | OtpPoolScope; count: number };

// Why a code is not sent although the request is accepted.
export type OtpSkipReason = "accounts" | "new" | "new_ip" | "sent";

export type OtpSendDecision =
  // Accepted: the answer is "sent" either way; `deliver` says whether the
  // message really goes out (`skipped` says why not).
  | { allowed: true; deliver: boolean; skipped: OtpSkipReason | null }
  // A limit of the address or the IP (429), counted the same for every address.
  | { allowed: false; reason: "rate"; retryAfterSeconds: number };

export interface OtpSendLimiter {
  // Counts the request in the address and IP buckets when all of them have room
  // (and in a pool when the code goes out); otherwise counts nothing and says
  // when to retry. Throws on a database failure.
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
  newAccountLimit: number;
  // The address has an account (filled by the adapter, never by the route).
  hasAccount: boolean;
  // Defaults to NEW_ACCOUNTS_PER_IP_DAILY; a parameter so tests reach the branch.
  newAccountsPerIp?: number;
  now: Date;
}>;

const countOf = (daily: readonly OtpDailyBucket[], scope: OtpDailyBucket["scope"]) =>
  daily.find((bucket) => bucket.scope === scope)?.count ?? 0;

// Whether the message goes out for an accepted request: never refuses.
function decideDelivery(
  state: OtpSendState,
): Pick<OtpSendDecision & { allowed: true }, "deliver" | "skipped"> {
  const { daily } = state;
  const pools = otpPools(state.globalLimit, state.newAccountLimit);

  if (countOf(daily, "sentEmail") >= SENT_PER_EMAIL_DAILY) {
    return { deliver: false, skipped: "sent" };
  }

  if (pools.shared) {
    return countOf(daily, "global") < pools.accounts
      ? { deliver: true, skipped: null }
      : { deliver: false, skipped: state.hasAccount ? "accounts" : "new" };
  }

  if (state.hasAccount) {
    return countOf(daily, "accounts") < pools.accounts
      ? { deliver: true, skipped: null }
      : { deliver: false, skipped: "accounts" };
  }

  if (countOf(daily, "newAccounts") >= pools.newAccounts) {
    return { deliver: false, skipped: "new" };
  }

  // Without a known IP there is no IP bucket and the limit does not apply.
  return daily.some(({ scope }) => scope === "ip") &&
    countOf(daily, "ip") >= (state.newAccountsPerIp ?? NEW_ACCOUNTS_PER_IP_DAILY)
    ? { deliver: false, skipped: "new_ip" }
    : { deliver: true, skipped: null };
}

// Pure decision over the stored state of the request's buckets at `now`. Only
// the limits of the address and the IP refuse a request (429), the same for
// every address; the pools decide just whether the message goes out.
export function decideOtpSend(state: OtpSendState): OtpSendDecision {
  const { now } = state;
  const untilTomorrow = msUntilNextUtcDay(now);
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

  for (const { scope, count } of state.daily) {
    if (scope in otpSendLimits.daily && count >= otpSendLimits.daily[scope as OtpSendScope]) {
      retryAfterMs = Math.max(retryAfterMs, untilTomorrow);
    }
  }

  return retryAfterMs > 0
    ? { allowed: false, reason: "rate", retryAfterSeconds: seconds(retryAfterMs) }
    : { allowed: true, ...decideDelivery(state) };
}

// The alarm to log after a pool counter reached `count`: once when it crosses
// 80% of the limit and once when it reaches the limit.
export function globalLimitAlarm(count: number, limit: number): "80" | "100" | null {
  if (count === limit) {
    return "100";
  }

  return count === Math.ceil(limit * GLOBAL_ALARM_RATIO) ? "80" : null;
}
