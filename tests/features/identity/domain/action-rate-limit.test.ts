import { describe, expect, it } from "vitest";

import {
  MAX_ACTION_WINDOW_SECONDS,
  assertValidLimit,
  decideAction,
  type ActionLimit,
} from "@/features/identity/domain/action-rate-limit";
import { SIGN_IN_WINDOW_SECONDS } from "@/features/identity/domain/sign-in-throttle";

const sample: ActionLimit = { limit: 30, windowSeconds: 600 };
const limit = { limit: 3, windowSeconds: 600 };

describe("decideAction", () => {
  it("allows requests up to the limit", () => {
    expect(decideAction(1, 0, limit)).toEqual({ allowed: true });
    expect(decideAction(3, 1000, limit)).toEqual({ allowed: true });
  });

  it("refuses over the limit and says when the window ends", () => {
    expect(decideAction(4, 100_000, limit)).toEqual({ allowed: false, retryAfterSeconds: 500 });
  });

  it("rounds up and never answers less than a second", () => {
    expect(decideAction(4, 599_001, limit)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(decideAction(4, 700_000, limit)).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });
});

describe("assertValidLimit", () => {
  it("accepts a valid limit", () => {
    expect(() => assertValidLimit(sample)).not.toThrow();
    expect(() =>
      assertValidLimit({ limit: 1, windowSeconds: SIGN_IN_WINDOW_SECONDS }),
    ).not.toThrow();
  });

  it("rejects a limit that is not a positive integer", () => {
    expect(() => assertValidLimit({ limit: 0, windowSeconds: 60 })).toThrow(RangeError);
    expect(() => assertValidLimit({ limit: 1.5, windowSeconds: 60 })).toThrow(RangeError);
  });

  it("accepts windows of one hour and of 24 hours", () => {
    expect(() => assertValidLimit({ limit: 20, windowSeconds: 3600 })).not.toThrow();
    expect(() =>
      assertValidLimit({ limit: 1, windowSeconds: MAX_ACTION_WINDOW_SECONDS }),
    ).not.toThrow();
  });

  it("rejects a window the cleanup could cut short", () => {
    expect(() =>
      assertValidLimit({ limit: 1, windowSeconds: MAX_ACTION_WINDOW_SECONDS + 1 }),
    ).toThrow(RangeError);
    expect(() => assertValidLimit({ limit: 1, windowSeconds: 0 })).toThrow(RangeError);
  });
});

describe("longer windows", () => {
  const daily = { limit: 5, windowSeconds: 24 * 60 * 60 };
  const hourly = { limit: 20, windowSeconds: 60 * 60 };

  it("allows the last request of a 24-hour window and refuses the next", () => {
    expect(decideAction(5, 3_600_000, daily)).toEqual({ allowed: true });
    expect(decideAction(6, 3_600_000, daily)).toEqual({
      allowed: false,
      retryAfterSeconds: 23 * 3600,
    });
  });

  it("says one second at the very end of a 24-hour window", () => {
    expect(decideAction(6, daily.windowSeconds * 1000 - 1, daily)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it("allows the 20th decision of an hour and refuses the 21st", () => {
    expect(decideAction(20, 60_000, hourly)).toEqual({ allowed: true });
    expect(decideAction(21, 60_000, hourly)).toEqual({
      allowed: false,
      retryAfterSeconds: 3540,
    });
  });
});

describe("sign-in window", () => {
  it("is still accepted as an action window", () => {
    expect(() =>
      assertValidLimit({ limit: 1, windowSeconds: SIGN_IN_WINDOW_SECONDS }),
    ).not.toThrow();
  });
});
