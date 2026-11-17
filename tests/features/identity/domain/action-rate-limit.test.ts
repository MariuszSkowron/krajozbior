import { describe, expect, it } from "vitest";

import {
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

  it("rejects a window the sign-in cleanup could cut short", () => {
    expect(() => assertValidLimit({ limit: 1, windowSeconds: SIGN_IN_WINDOW_SECONDS + 1 })).toThrow(
      RangeError,
    );
    expect(() => assertValidLimit({ limit: 1, windowSeconds: 0 })).toThrow(RangeError);
  });
});
