import { describe, expect, it } from "vitest";

import {
  COLLECTION_STATUSES,
  REGIONS,
  isRegion,
  normalizeLineBreaks,
  validateCollectionInput,
} from "@/features/catalog/domain/collection";

const valid = { title: "  Wieże Tczewa ", summary: "Krótki opis", region: "pomorskie" };

describe("validateCollectionInput", () => {
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
