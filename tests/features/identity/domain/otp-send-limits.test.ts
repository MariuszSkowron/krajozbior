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
      reason: "rate",
      retryAfterSeconds: HOUR,
    });
    expect(decide([], [{ scope, count: limit - 1 }])).toEqual({ allowed: true });
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

describe("globalLimitAlarm", () => {
  it("fires once at 80% and once at 100%", () => {
    expect(globalLimitAlarm(199, 250)).toBeNull();
    expect(globalLimitAlarm(200, 250)).toBe("80");
    expect(globalLimitAlarm(201, 250)).toBeNull();
    expect(globalLimitAlarm(250, 250)).toBe("100");
    expect(globalLimitAlarm(1, 1)).toBe("100");
  });
});
