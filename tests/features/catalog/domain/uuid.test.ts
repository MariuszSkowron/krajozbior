import { describe, expect, it } from "vitest";

import { isUuid } from "@/features/catalog/domain/uuid";

describe("isUuid", () => {
  it("accepts a UUID in either case", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("ABCDEF12-1111-4111-8111-111111111111")).toBe(true);
  });

  it("rejects other values", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(5)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
