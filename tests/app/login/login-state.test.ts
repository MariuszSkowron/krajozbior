import { describe, expect, it } from "vitest";

import { marksFieldsInvalid, wasRestoredFromCache } from "@/app/login/login-state";

describe("marksFieldsInvalid", () => {
  it("marks the fields only for wrong credentials", () => {
    expect(marksFieldsInvalid("invalid_credentials")).toBe(true);
    expect(marksFieldsInvalid("unavailable")).toBe(false);
    expect(marksFieldsInvalid("too_many_attempts")).toBe(false);
    expect(marksFieldsInvalid(undefined)).toBe(false);
  });
});

describe("wasRestoredFromCache", () => {
  it("is true only for a persisted page", () => {
    expect(wasRestoredFromCache({ persisted: true })).toBe(true);
    expect(wasRestoredFromCache({ persisted: false })).toBe(false);
  });
});
