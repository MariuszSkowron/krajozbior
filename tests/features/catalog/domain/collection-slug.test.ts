import { describe, expect, it } from "vitest";

import { generateCollectionSlug, slugBase } from "@/features/catalog/domain/collection-slug";

describe("slugBase", () => {
  it("writes Polish titles in ASCII words", () => {
    expect(slugBase("Wieże Tczewa — Łódź, żółć!")).toBe("wieze-tczewa-lodz-zolc");
  });

  it("falls back for a title without letters or digits", () => {
    expect(slugBase("???")).toBe("kolekcja");
  });

  it("cuts a long title at 60 characters without a trailing hyphen", () => {
    expect(slugBase(`${"a".repeat(59)} bbb`)).toBe("a".repeat(59));
    expect(slugBase("a".repeat(100))).toHaveLength(60);
  });
});

describe("generateCollectionSlug", () => {
  it("adds a 6 character suffix drawn from the injected source", () => {
    let call = 0;

    expect(generateCollectionSlug("Wieże Tczewa", () => call++)).toBe("wieze-tczewa-abcdef");
  });

  it("draws a different suffix on the next call", () => {
    const draws = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
    let call = 0;
    const random = () => draws[call++]!;

    expect(generateCollectionSlug("x", random)).toBe("x-aaaaaa");
    expect(generateCollectionSlug("x", random)).toBe("x-bbbbbb");
  });
});
