import { describe, expect, it } from "vitest";

import {
  decideOtpSend,
  globalLimitAlarm,
  msUntilNextUtcDay,
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

const decide = (window: OtpWindowBucket[], daily: OtpDailyBucket[] = [], globalLimit = 250) =>
  decideOtpSend({ window, daily, globalLimit, now });

describe("decideOtpSend: limits of sign-in code requests", () => {
  it("allows a request with room everywhere, also with no stored rows", () => {
    expect(decide([])).toEqual({ allowed: true });
    expect(decide([win({ attempts: 2 })], [{ scope: "global", count: 249 }])).toEqual({
      allowed: true,
    });
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
    expect(decide([win({ scope, attempts: limit - 1 })])).toEqual({ allowed: true });
  });

  it("counts an ended window as empty", () => {
    expect(decide([win({ attempts: 99, windowStartedAt: ago(OTP_SEND_WINDOW_SECONDS) })])).toEqual({
      allowed: true,
    });
  });

  it("refuses during an operator block and ignores an ended one", () => {
    const lockedUntil = new Date(now.getTime() + 600_000);

    expect(decide([win({ lockedUntil })])).toEqual({
      allowed: false,
      reason: "rate",
      retryAfterSeconds: 600,
    });
    expect(decide([win({ lockedUntil: ago(1) })])).toEqual({ allowed: true });
  });

  it.each([
    ["emailIp", otpSendLimits.daily.emailIp],
    ["email", otpSendLimits.daily.email],
    ["ip", otpSendLimits.daily.ip],
  ] as const)("refuses a full daily %s bucket until UTC midnight", (scope, limit) => {
    expect(decide([], [{ scope, count: limit }])).toEqual({
      allowed: false,
      reason: "daily",
      retryAfterSeconds: HOUR,
    });
    expect(decide([], [{ scope, count: limit - 1 }])).toEqual({ allowed: true });
  });

  it("takes the longest wait of several full buckets", () => {
    expect(
      decide(
        [win({ scope: "email", attempts: 5, windowStartedAt: ago(60) })],
        [{ scope: "ip", count: 100 }],
      ),
    ).toEqual({ allowed: false, reason: "daily", retryAfterSeconds: HOUR });
    expect(
      decide(
        [win({ scope: "email", attempts: 5, windowStartedAt: ago(60) })],
        [{ scope: "ip", count: 99 }],
      ),
    ).toEqual({ allowed: false, reason: "rate", retryAfterSeconds: OTP_SEND_WINDOW_SECONDS - 60 });
  });

  it("answers with the global limit first, whatever the other buckets say", () => {
    expect(decide([win({ attempts: 99 })], [{ scope: "global", count: 250 }])).toEqual({
      allowed: false,
      reason: "global",
      retryAfterSeconds: HOUR,
    });
    expect(decide([], [{ scope: "global", count: 10 }], 10).allowed).toBe(false);
  });
});

describe("msUntilNextUtcDay", () => {
  it("counts to the next UTC midnight", () => {
    expect(msUntilNextUtcDay(now)).toBe(HOUR * 1000);
    expect(msUntilNextUtcDay(new Date("2026-11-15T00:00:00Z"))).toBe(24 * HOUR * 1000);
  });
});

describe("day boundary (UTC, not Polish time)", () => {
  const HOUR_MS = 3_600_000;

  it("the day ends at UTC midnight: 01:00 in winter and 02:00 in summer in Poland", () => {
    // 28.11 23:59:30 UTC (winter, 00:59:30 in Poland): 30 s to the reset.
    expect(msUntilNextUtcDay(new Date("2026-11-28T23:59:30Z"))).toBe(30_000);
    // Exactly UTC midnight: a new day starts, the next reset is 24 h away.
    expect(msUntilNextUtcDay(new Date("2026-11-29T00:00:00Z"))).toBe(24 * HOUR_MS);
    // Polish midnight in winter (23:00 UTC) is not the boundary: one hour left.
    expect(msUntilNextUtcDay(new Date("2026-11-28T23:00:00Z"))).toBe(HOUR_MS);
    // Summer: Polish midnight is 22:00 UTC; two hours left.
    expect(msUntilNextUtcDay(new Date("2026-07-15T22:00:00Z"))).toBe(2 * HOUR_MS);
  });

  it("a full daily bucket sends Retry-After to UTC midnight, as a daily refusal", () => {
    // Polish noon (11:00 UTC in winter): 13 h to 00:00 UTC.
    const decision = decideOtpSend({
      window: [],
      daily: [{ scope: "email", count: otpSendLimits.daily.email }],
      globalLimit: 250,
      now: new Date("2026-11-28T11:00:00Z"),
    });

    expect(decision).toEqual({ allowed: false, reason: "daily", retryAfterSeconds: 13 * 3600 });
  });

  it("the first second of a new UTC day lets the request in (no row for the new day)", () => {
    expect(
      decideOtpSend({
        window: [],
        daily: [],
        globalLimit: 250,
        now: new Date("2026-11-29T00:00:01Z"),
      }),
    ).toEqual({ allowed: true });
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
