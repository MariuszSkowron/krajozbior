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

  it("refuses hidden direction, zero-width and control characters (U-1)", () => {
    const hidden = ["‮", "‎", "‏", "؜", "​", "‍", "﻿", "\u0007"];

    for (const mark of hidden) {
      expect(validateOwnCollectionInput({ title: `A${mark}B`, region: "polska" })).toEqual({
        ok: false,
        errors: ["title"],
      });
      expect(
        validateOwnCollectionInput({ title: "A", summary: `a${mark}b`, region: "polska" }),
      ).toEqual({ ok: false, errors: ["summary"] });
    }

    expect(validateOwnCollectionInput({ title: "A\nB", region: "polska" }).ok).toBe(false);
    expect(
      validateOwnCollectionInput({ title: "A", summary: "a\nb\n\nc", region: "polska" }).ok,
    ).toBe(true);
  });

  it("allows emoji sequences with a skin tone and tag flags, still refuses a bare joiner (U-1)", () => {
    const allowed = [
      "\u{1F469}\u{1F3FD}‍\u{1F680}",
      "\u{1F9D1}\u{1F3FF}‍\u{1F91D}‍\u{1F9D1}\u{1F3FB}",
      "\u{1F468}‍\u{1F469}‍\u{1F467}",
      "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
    ];

    for (const emoji of allowed) {
      expect(
        validateOwnCollectionInput({ title: `A ${emoji}`, summary: emoji, region: "polska" }).ok,
      ).toBe(true);
    }

    expect(validateOwnCollectionInput({ title: "a‍b", region: "polska" }).ok).toBe(false);
    expect(validateOwnCollectionInput({ title: "\u{E0067}", region: "polska" }).ok).toBe(false);
  });

  it("allows only the three tag flags and refuses any other tag sequence (U-1)", () => {
    const tags = (text: string) =>
      [...text].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("");
    const cancel = "\u{E007F}";
    const flag = "\u{1F3F4}";

    for (const code of ["gbeng", "gbsct", "gbwls"]) {
      const text = `${flag}${tags(code)}${cancel}`;

      expect(validateOwnCollectionInput({ title: text, summary: text, region: "polska" }).ok).toBe(
        true,
      );
    }
    for (const hidden of [
      `${flag}${tags("gbxyz")}${cancel}`,
      `${flag}${tags("a".repeat(50))}${cancel}`,
      `${flag}${tags("gbeng")}`,
      `${tags("gbeng")}${cancel}`,
      `${flag}${tags("gbengx")}${cancel}`,
    ]) {
      expect(validateOwnCollectionInput({ title: `A ${hidden}`, region: "polska" }).ok).toBe(false);
      expect(validateOwnCollectionInput({ title: "A", summary: hidden, region: "polska" }).ok).toBe(
        false,
      );
    }
  });

  it("keeps a tab allowed in the summary (U-1)", () => {
    expect(validateOwnCollectionInput({ title: "A", summary: "a\tb", region: "polska" }).ok).toBe(
      true,
    );
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
