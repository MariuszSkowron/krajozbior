import { describe, expect, it } from "vitest";

import {
  collectionCoverLateral,
  coverCardColumns,
  coverCreditColumns,
  toCardCover,
} from "@/features/catalog/infrastructure/collection-cover-sql";

describe("toCardCover", () => {
  it("maps a full row to the thumbnail", () => {
    expect(
      toCardCover({ coverPhotoId: "p", coverWidth: 400, coverHeight: 300, coverAltText: "Most" }),
    ).toEqual({ photoId: "p", width: 400, height: 300, altText: "Most" });
  });

  it.each([
    { coverPhotoId: null, coverWidth: 1, coverHeight: 1, coverAltText: "a" },
    { coverPhotoId: "p", coverWidth: null, coverHeight: 1, coverAltText: "a" },
    { coverPhotoId: "p", coverWidth: 1, coverHeight: null, coverAltText: "a" },
    { coverPhotoId: "p", coverWidth: 1, coverHeight: 1, coverAltText: null },
  ])("is null when a column is missing: %j", (row) => {
    expect(toCardCover(row)).toBeNull();
  });
});

describe("cover SQL fragments", () => {
  it("name the columns with the alias and never select the whole row", () => {
    expect(coverCardColumns("x")).toContain('x.id as "coverPhotoId"');
    expect(coverCreditColumns("x")).toContain('x.title as "title"');
    expect(coverCreditColumns("x", "photoTitle")).toContain('x.title as "photoTitle"');
    expect(collectionCoverLateral("x")).toMatch(/\) x on true$/);
    expect(collectionCoverLateral("x")).not.toContain("ph.*");
  });
});
