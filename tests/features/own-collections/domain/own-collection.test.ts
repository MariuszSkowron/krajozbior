import { describe, expect, it } from "vitest";

import { REGIONS } from "@/features/catalog/domain/collection";
import {
  MAX_ITEMS_PER_OWN_COLLECTION,
  MAX_MY_COLLECTIONS,
  MAX_OWN_COLLECTIONS,
  OWN_COLLECTION_BODY_MAX_BYTES,
  OWN_COLLECTION_SEARCH_LIMIT,
  OWN_COLLECTION_WRITE_ACTION,
  ownCollectionWriteLimit,
} from "@/features/own-collections/domain/limits";
import {
  OWN_REGIONS,
  OWN_REGION_LABELS,
  isOwnRegion,
  validateOwnCollectionInput,
} from "@/features/own-collections/domain/own-collection";
import { assertValidLimit } from "@/features/identity/domain/action-rate-limit";

describe("limits of own collections (E8-Q9, [P-E8-A3])", () => {
  it("keeps the accepted values", () => {
    expect(MAX_OWN_COLLECTIONS).toBe(50);
    expect(MAX_MY_COLLECTIONS).toBe(200);
    expect(MAX_ITEMS_PER_OWN_COLLECTION).toBe(200);
    expect(OWN_COLLECTION_WRITE_ACTION).toBe("own_collection_write");
    expect(ownCollectionWriteLimit).toEqual({ limit: 60, windowSeconds: 600 });
    expect(() => assertValidLimit(ownCollectionWriteLimit)).not.toThrow();
    expect(OWN_COLLECTION_BODY_MAX_BYTES).toBeGreaterThan(1000);
    expect(OWN_COLLECTION_SEARCH_LIMIT).toBeGreaterThan(0);
  });
});

describe("regions of an own collection (D-34)", () => {
  it("are the 16 voivodeships and the whole country, each with a Polish label", () => {
    expect(OWN_REGIONS).toHaveLength(REGIONS.length + 1);
    expect(OWN_REGIONS.at(-1)).toBe("polska");
    expect(OWN_REGION_LABELS.polska).toBe("Cała Polska");
    expect(OWN_REGION_LABELS.pomorskie).toBe("Pomorskie");
    expect(isOwnRegion("polska")).toBe(true);
    expect(isOwnRegion("slaskie")).toBe(true);
    expect(isOwnRegion("europa")).toBe(false);
    expect(isOwnRegion(7)).toBe(false);
  });
});

describe("validateOwnCollectionInput", () => {
  it("accepts a title, a summary and a region, trimmed", () => {
    expect(
      validateOwnCollectionInput({
        title: "  Wieże ciśnień  ",
        summary: " Moje ulubione ",
        region: "polska",
      }),
    ).toEqual({
      ok: true,
      value: { title: "Wieże ciśnień", summary: "Moje ulubione", region: "polska" },
    });
  });

  it("makes the summary optional", () => {
    expect(validateOwnCollectionInput({ title: "A", region: "pomorskie" })).toEqual({
      ok: true,
      value: { title: "A", summary: "", region: "pomorskie" },
    });
  });

  it("counts a line break of a form once", () => {
    const summary = `${"a".repeat(139)}\r\n${"b".repeat(140)}`;

    expect(validateOwnCollectionInput({ title: "A", summary, region: "polska" }).ok).toBe(true);
  });

  it("refuses an empty, too long or NUL title", () => {
    for (const title of ["", "   ", "x".repeat(121), "a\u0000b", 5, undefined]) {
      expect(validateOwnCollectionInput({ title, region: "polska" })).toEqual({
        ok: false,
        errors: ["title"],
      });
    }
  });

  it("refuses a too long, NUL or non-text summary", () => {
    for (const summary of ["x".repeat(281), "a\u0000b", 5, null]) {
      expect(validateOwnCollectionInput({ title: "A", summary, region: "polska" })).toEqual({
        ok: false,
        errors: ["summary"],
      });
    }
  });

  it("refuses an unknown region and reports every wrong field", () => {
    expect(validateOwnCollectionInput({ title: "", summary: 1, region: "mars" })).toEqual({
      ok: false,
      errors: ["title", "summary", "region"],
    });
  });
});
