import { describe, expect, it } from "vitest";

import {
  decideOtpSend,
  globalLimitAlarm,
  msUntilNextUtcDay,
  NEW_ACCOUNTS_PER_IP_DAILY,
  otpPools,
  SENT_PER_EMAIL_DAILY,
  OTP_SEND_WINDOW_SECONDS,
  otpSendLimits,
  type OtpDailyBucket,
  type OtpWindowBucket,
} from "@/features/identity/domain/otp-send-limits";

const now = new Date("2026-11-15T23:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);
const HOUR = 3600;

function win(overrides: Partial<OtpWindowBucket> = {}): OtpWindowBucket {
  return {
    scope: "emailIp",
    attempts: 0,
    windowStartedAt: ago(60),
    lockedUntil: null,
    ...overrides,
  };
}

const SENT = { allowed: true, deliver: true, skipped: null } as const;
const skipped = (reason: "accounts" | "new" | "new_ip" | "sent") =>
  ({ allowed: true, deliver: false, skipped: reason }) as const;

const decide = (
  window: OtpWindowBucket[],
  daily: OtpDailyBucket[] = [],
  options: { globalLimit?: number; newAccountLimit?: number; hasAccount?: boolean } = {},
) =>
  decideOtpSend({
    window,
    daily,
    globalLimit: options.globalLimit ?? 250,
    newAccountLimit: options.newAccountLimit ?? 100,
    hasAccount: options.hasAccount ?? false,
    now,
  });

describe("decideOtpSend: limits of sign-in code requests", () => {
  it("allows a request with room everywhere, also with no stored rows", () => {
    expect(decide([])).toEqual(SENT);
    expect(decide([win({ attempts: 2 })], [{ scope: "global", count: 249 }])).toEqual(SENT);
  });

  it.each([
    ["emailIp", otpSendLimits.window.emailIp],
    ["email", otpSendLimits.window.email],
    ["ip", otpSendLimits.window.ip],
  ] as const)("refuses a full 15-minute %s bucket until its window ends", (scope, limit) => {
    expect(decide([win({ scope, attempts: limit, windowStartedAt: ago(300) })])).toEqual({
      allowed: false,
      reason: "rate",
      retryAfterSeconds: OTP_SEND_WINDOW_SECONDS - 300,
    });
    expect(decide([win({ scope, attempts: limit - 1 })])).toEqual(SENT);
  });

  it("counts an ended window as empty", () => {
    expect(decide([win({ attempts: 99, windowStartedAt: ago(OTP_SEND_WINDOW_SECONDS) })])).toEqual(
      SENT,
    );
  });

  it("refuses during an operator block and ignores an ended one", () => {
    const lockedUntil = new Date(now.getTime() + 600_000);

    expect(decide([win({ lockedUntil })])).toEqual({
      allowed: false,
      reason: "rate",
      retryAfterSeconds: 600,
    });
    expect(decide([win({ lockedUntil: ago(1) })])).toEqual(SENT);
  });

  it.each([
    ["emailIp", otpSendLimits.daily.emailIp],
    ["email", otpSendLimits.daily.email],
    ["ip", otpSendLimits.daily.ip],
  ] as const)("refuses a full daily %s bucket until UTC midnight", (scope, limit) => {
    expect(decide([], [{ scope, count: limit }])).toEqual({
      allowed: false,
      reason: "rate",
      retryAfterSeconds: HOUR,
    });
    expect(decide([], [{ scope, count: limit - 1 }])).toEqual(SENT);
  });

  it("takes the longest wait of several full buckets", () => {
    expect(
      decide(
        [win({ scope: "email", attempts: 5, windowStartedAt: ago(60) })],
        [{ scope: "ip", count: 30 }],
      ),
    ).toEqual({ allowed: false, reason: "rate", retryAfterSeconds: HOUR });
    expect(
      decide(
        [win({ scope: "email", attempts: 5, windowStartedAt: ago(60) })],
        [{ scope: "ip", count: 29 }],
      ),
    ).toEqual({ allowed: false, reason: "rate", retryAfterSeconds: OTP_SEND_WINDOW_SECONDS - 60 });
  });

  it("answers 429 identically for an address with and without an account", () => {
    const daily: OtpDailyBucket[] = [{ scope: "email", count: otpSendLimits.daily.email }];

    expect(decide([], daily, { hasAccount: true })).toEqual(
      decide([], daily, { hasAccount: false }),
    );
    expect(decide([], daily, { hasAccount: true })).toMatchObject({
      allowed: false,
      reason: "rate",
    });
  });
});

describe("decideOtpSend: pools of codes that go out", () => {
  const full = (scope: OtpDailyBucket["scope"], count: number): OtpDailyBucket => ({
    scope,
    count,
  });

  it("sends to an account while the accounts pool (total minus new) has room", () => {
    const options = { globalLimit: 10, newAccountLimit: 4, hasAccount: true };

    expect(decide([], [full("accounts", 5)], options)).toEqual(SENT);
    expect(decide([], [full("accounts", 6)], options)).toEqual(skipped("accounts"));
  });

  it("sends to a new address while the new pool has room", () => {
    const options = { globalLimit: 10, newAccountLimit: 4 };

    expect(decide([], [full("newAccounts", 3)], options)).toEqual(SENT);
    expect(decide([], [full("newAccounts", 4)], options)).toEqual(skipped("new"));
  });

  it("keeps the pools apart: a full pool does not touch the other one", () => {
    const options = { globalLimit: 10, newAccountLimit: 4 };

    expect(decide([], [full("newAccounts", 4)], { ...options, hasAccount: true })).toEqual(SENT);
    expect(decide([], [full("accounts", 6)], options)).toEqual(SENT);
  });

  it("never refuses when every pool is full", () => {
    const daily = [full("accounts", 6), full("newAccounts", 4), full("global", 10)];

    expect(decide([], daily, { globalLimit: 10, newAccountLimit: 4, hasAccount: true })).toEqual(
      skipped("accounts"),
    );
    expect(decide([], daily, { globalLimit: 10, newAccountLimit: 4 })).toEqual(skipped("new"));
  });

  it("uses one shared pool when the new share is not smaller than the total", () => {
    const options = { globalLimit: 10, newAccountLimit: 10 };

    expect(decide([], [full("global", 9)], options)).toEqual(SENT);
    expect(decide([], [full("global", 10)], options)).toEqual(skipped("new"));
    expect(decide([], [full("global", 10)], { ...options, hasAccount: true })).toEqual(
      skipped("accounts"),
    );
  });

  it("skips a new address from an IP with 30 requests today, but not an account", () => {
    // The threshold is a parameter of the state, so the branch is reachable
    // whatever the daily IP limit (which is 30 today and answers 429 first).
    const ipThreshold = (hasAccount: boolean, count: number) =>
      decideOtpSend({
        window: [],
        daily: [full("ip", count)],
        globalLimit: 250,
        newAccountLimit: 100,
        newAccountsPerIp: 20,
        hasAccount,
        now,
      });

    expect(ipThreshold(false, 19)).toEqual(SENT);
    expect(ipThreshold(false, 20)).toEqual(skipped("new_ip"));
    expect(ipThreshold(true, 20)).toEqual(SENT);
    expect(NEW_ACCOUNTS_PER_IP_DAILY).toBe(30);
  });

  it("has no IP threshold without an IP bucket", () => {
    expect(decide([], [])).toEqual(SENT);
  });

  it("skips codes to a mailbox that already got five today, whatever the pools", () => {
    const daily = [full("sentEmail", SENT_PER_EMAIL_DAILY)];

    expect(decide([], daily, { hasAccount: true })).toEqual(skipped("sent"));
    expect(decide([], daily)).toEqual(skipped("sent"));
    expect(decide([], [full("sentEmail", SENT_PER_EMAIL_DAILY - 1)])).toEqual(SENT);
  });

  it("computes the pool sizes", () => {
    expect(otpPools(250, 100)).toEqual({ shared: false, accounts: 150, newAccounts: 100 });
    expect(otpPools(10, 10)).toEqual({ shared: true, accounts: 10, newAccounts: 10 });
    expect(otpPools(10, 50)).toEqual({ shared: true, accounts: 10, newAccounts: 10 });
  });
});

describe("msUntilNextUtcDay", () => {
  it("counts to the next UTC midnight", () => {
    expect(msUntilNextUtcDay(now)).toBe(HOUR * 1000);
    expect(msUntilNextUtcDay(new Date("2026-11-15T00:00:00Z"))).toBe(24 * HOUR * 1000);
  });
});

describe("globalLimitAlarm", () => {
  it("fires once at 80% and once at 100%", () => {
    expect(globalLimitAlarm(199, 250)).toBeNull();
    expect(globalLimitAlarm(200, 250)).toBe("80");
    expect(globalLimitAlarm(201, 250)).toBeNull();
    expect(globalLimitAlarm(250, 250)).toBe("100");
    expect(globalLimitAlarm(1, 1)).toBe("100");
  });
});
