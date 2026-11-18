import { describe, expect, it } from "vitest";

import { isSlugTaken } from "@/features/catalog/infrastructure/postgres-catalog-repository";

// D-27: only a clash on the address index means "address taken".
describe("isSlugTaken", () => {
  it("recognizes the unique violation of the address, also wrapped", () => {
    const violation = { code: "23505", constraint: "collections_slug_key" };

    expect(isSlugTaken(violation)).toBe(true);
    expect(isSlugTaken(new Error("wrapped", { cause: violation }))).toBe(true);
  });

  it("does not retry another unique violation as an address clash", () => {
    expect(isSlugTaken({ code: "23505", constraint: "collections_pkey" })).toBe(false);
    expect(isSlugTaken({ code: "23505" })).toBe(false);
    expect(
      isSlugTaken(new Error("wrapped", { cause: { code: "23505", constraint: "other_key" } })),
    ).toBe(false);
  });

  it("ignores other errors and empty values", () => {
    expect(isSlugTaken({ code: "40001" })).toBe(false);
    expect(isSlugTaken(null)).toBe(false);
    expect(isSlugTaken(undefined)).toBe(false);
  });
});
