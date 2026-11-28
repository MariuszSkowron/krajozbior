import { describe, expect, it } from "vitest";

import {
  COLLECTION_STATUSES,
  REGIONS,
  isRegion,
  normalizeExtraRegions,
  normalizeLineBreaks,
  regionsLabelOf,
  regionsOf,
  validateCollectionInput,
} from "@/features/catalog/domain/collection";

const valid = { title: "  Wieże Tczewa ", summary: "Krótki opis", region: "pomorskie" };

describe("validateCollectionInput", () => {
  it("rejects a NUL character in the title and the summary (invalid input, not a database error)", () => {
    expect(validateCollectionInput({ ...valid, title: "a\u0000b" })).toEqual({
      ok: false,
      errors: ["title"],
    });
    expect(validateCollectionInput({ ...valid, summary: "a\u0000b" })).toEqual({
      ok: false,
      errors: ["summary"],
    });
  });

  it("accepts a valid form and trims the title", () => {
    expect(validateCollectionInput(valid)).toEqual({
      ok: true,
      value: { title: "Wieże Tczewa", summary: "Krótki opis", region: "pomorskie" },
    });
  });

  it("defaults a missing summary to an empty text", () => {
    expect(validateCollectionInput({ title: "A", region: "lubelskie" })).toMatchObject({
      ok: true,
      value: { summary: "" },
    });
  });

  it("counts a CRLF line break as one character", () => {
    const summary = "a\r\n".repeat(140);

    expect(validateCollectionInput({ ...valid, summary }).ok).toBe(true);
    expect(validateCollectionInput({ ...valid, summary: "a".repeat(281) })).toEqual({
      ok: false,
      errors: ["summary"],
    });
    expect(validateCollectionInput({ ...valid, summary: "a".repeat(280) }).ok).toBe(true);
  });

  it("names every wrong field", () => {
    expect(validateCollectionInput({ title: "  ", summary: 5, region: "mars" })).toEqual({
      ok: false,
      errors: ["title", "summary", "region"],
    });
    expect(validateCollectionInput({ title: "x".repeat(121), region: "lubelskie" })).toEqual({
      ok: false,
      errors: ["title"],
    });
    expect(validateCollectionInput({ title: 1, region: "lubelskie" })).toEqual({
      ok: false,
      errors: ["title"],
    });
  });
});

describe("normalizeExtraRegions", () => {
  it("accepts an empty list and returns the extra regions in the order of REGIONS", () => {
    expect(normalizeExtraRegions("dolnoslaskie", [])).toEqual({ ok: true, value: [] });
    expect(normalizeExtraRegions("dolnoslaskie", ["slaskie", "opolskie"])).toEqual({
      ok: true,
      value: ["opolskie", "slaskie"],
    });
  });

  it("rejects an unknown code, a repeat, the main region and more than three", () => {
    expect(normalizeExtraRegions("dolnoslaskie", ["opolskie", "atlantyda", 3])).toEqual({
      ok: false,
      errors: [
        { code: "bad_value", index: 1 },
        { code: "bad_value", index: 2 },
      ],
    });
    expect(normalizeExtraRegions("dolnoslaskie", ["opolskie", "opolskie"])).toEqual({
      ok: false,
      errors: [{ code: "duplicate", index: 1 }],
    });
    expect(normalizeExtraRegions("dolnoslaskie", ["dolnoslaskie"])).toEqual({
      ok: false,
      errors: [{ code: "same_as_region", index: 0 }],
    });
    expect(
      normalizeExtraRegions("dolnoslaskie", ["opolskie", "slaskie", "lubuskie", "lodzkie"]),
    ).toEqual({ ok: false, errors: [{ code: "too_many", index: null }] });
    expect(
      normalizeExtraRegions("dolnoslaskie", ["opolskie", "slaskie", "lubuskie"]),
    ).toMatchObject({ ok: true });
  });
});

describe("regionsOf and regionsLabelOf", () => {
  it("puts the main region first and joins the labels", () => {
    const collection = { region: "dolnoslaskie", extraRegions: ["opolskie"] } as const;

    expect(regionsOf(collection)).toEqual(["dolnoslaskie", "opolskie"]);
    expect(regionsLabelOf(collection)).toBe("Dolnośląskie · Opolskie");
    expect(regionsLabelOf({ region: "lodzkie", extraRegions: [] })).toBe("Łódzkie");
  });
});

describe("collection lists", () => {
  it("has 16 regions and two statuses", () => {
    expect(REGIONS).toHaveLength(16);
    expect(COLLECTION_STATUSES).toEqual(["draft", "published"]);
    expect(isRegion("slaskie")).toBe(true);
    expect(isRegion("Śląskie")).toBe(false);
    expect(isRegion(3)).toBe(false);
  });

  it("normalizes line breaks", () => {
    expect(normalizeLineBreaks("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});

describe("labels for screens", () => {
  it("names every voivodeship and every state in Polish", async () => {
    const { COLLECTION_STATUS_LABELS, REGION_LABELS } =
      await import("@/features/catalog/domain/collection");

    expect(Object.keys(REGION_LABELS).sort()).toEqual([...REGIONS].sort());
    expect(Object.keys(COLLECTION_STATUS_LABELS).sort()).toEqual([...COLLECTION_STATUSES].sort());
    expect(REGION_LABELS.lodzkie).toBe("Łódzkie");
    expect(COLLECTION_STATUS_LABELS).toEqual({ draft: "Szkic", published: "Opublikowana" });
  });
});
