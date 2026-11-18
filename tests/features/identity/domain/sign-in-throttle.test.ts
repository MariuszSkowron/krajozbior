import { describe, expect, it } from "vitest";

import {
  decide,
  normalizeEmail,
  SIGN_IN_WINDOW_SECONDS,
  signInLimits,
  type BucketState,
} from "@/features/identity/domain/sign-in-throttle";

const now = new Date("2026-10-28T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);

function bucket(overrides: Partial<BucketState> = {}): BucketState {
  return {
    scope: "accountIp",
    attempts: 0,
    windowStartedAt: ago(60),
    lockedUntil: null,
    ...overrides,
  };
}

describe("decide", () => {
  it("allows while every bucket is under its limit", () => {
    expect(
      decide(
        [
          bucket({ attempts: signInLimits.accountIp - 1 }),
          bucket({ scope: "ip", attempts: signInLimits.ip - 1 }),
          bucket({ scope: "account", attempts: signInLimits.account - 1 }),
        ],
        now,
      ),
    ).toEqual({ allowed: true });
  });

  it("refuses when one bucket is full and says when its window ends", () => {
    expect(
      decide([bucket({ attempts: signInLimits.accountIp }), bucket({ scope: "ip" })], now),
    ).toEqual({ allowed: false, retryAfterSeconds: SIGN_IN_WINDOW_SECONDS - 60 });
  });

  it("treats an expired window as empty", () => {
    expect(
      decide([bucket({ attempts: 99, windowStartedAt: ago(SIGN_IN_WINDOW_SECONDS) })], now),
    ).toEqual({ allowed: true });
  });

  it("refuses a manually blocked bucket even with no attempts", () => {
    const lockedUntil = new Date(now.getTime() + 3_600_000);

    expect(decide([bucket({ scope: "account", lockedUntil })], now)).toEqual({
      allowed: false,
      retryAfterSeconds: 3600,
    });
  });

  it("ignores a block that has ended", () => {
    expect(decide([bucket({ lockedUntil: ago(1) })], now)).toEqual({ allowed: true });
  });

  it("reports the longest wait among the refusing buckets", () => {
    const decision = decide(
      [
        bucket({ attempts: signInLimits.accountIp, windowStartedAt: ago(800) }),
        bucket({ scope: "ip", attempts: signInLimits.ip, windowStartedAt: ago(10) }),
      ],
      now,
    );

    expect(decision).toEqual({ allowed: false, retryAfterSeconds: SIGN_IN_WINDOW_SECONDS - 10 });
  });
});

describe("normalizeEmail", () => {
  it("keys every spelling of an address the same way", () => {
    expect(normalizeEmail("  USER@Demo.krajozbior.local ")).toBe("user@demo.krajozbior.local");
  });
});
