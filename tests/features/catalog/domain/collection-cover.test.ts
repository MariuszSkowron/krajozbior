import { describe, expect, it } from "vitest";

import {
  cardCoverImage,
  ogCoverDescription,
  ogImageUrl,
} from "@/features/catalog/domain/collection-cover";

const ID = "0b6f3a52-7c41-4b7e-9d0a-1c2d3e4f5a6b";

describe("cardCoverImage (E4-3)", () => {
  it("is null without a cover (the card keeps the placeholder)", () => {
    expect(cardCoverImage(null)).toBeNull();
  });

  it("points at the w400 thumbnail and scales the size to 400 px", () => {
    expect(cardCoverImage({ photoId: ID, width: 1280, height: 853, altText: "Zamek" })).toEqual({
      src: `/media/p/${ID}/w400`,
      width: 400,
      height: 267,
      alt: "Zamek",
    });
  });

  it("does not enlarge a photo narrower than the thumbnail", () => {
    expect(cardCoverImage({ photoId: ID, width: 300, height: 200, altText: "Mały" })).toEqual({
      src: `/media/p/${ID}/w400`,
      width: 300,
      height: 200,
      alt: "Mały",
    });
  });

  it("never gives a zero height for a very wide photo", () => {
    expect(cardCoverImage({ photoId: ID, width: 100000, height: 1, altText: "Pas" })?.height).toBe(
      1,
    );
  });
});

describe("ogImageUrl (E4-3)", () => {
  it("builds the absolute address of the og size under the origin of the service", () => {
    expect(ogImageUrl("https://krajozbior.example/", { photoId: ID })).toBe(
      `https://krajozbior.example/media/p/${ID}/og`,
    );
    expect(ogImageUrl("http://127.0.0.1:3100/ścieżka?x=1", { photoId: ID })).toBe(
      `http://127.0.0.1:3100/media/p/${ID}/og`,
    );
  });

  it("is null without a cover, without the address of the service or with a broken one", () => {
    expect(ogImageUrl("https://krajozbior.example", null)).toBeNull();
    expect(ogImageUrl(undefined, { photoId: ID })).toBeNull();
    expect(ogImageUrl("  ", { photoId: ID })).toBeNull();
    expect(ogImageUrl("nie adres", { photoId: ID })).toBeNull();
  });
});

describe("ogCoverDescription (E4-3, uznanie autorstwa w podglądzie linku)", () => {
  it("names the author, the licence and Wikimedia Commons for a Commons import", () => {
    expect(
      ogCoverDescription({
        authorText: " Fikcyjny Autor ",
        licenseLabel: "CC BY-SA 3.0 PL",
        sourceKind: "commons_import",
      }),
    ).toBe("Okładka: fot. Fikcyjny Autor, CC BY-SA 3.0 PL, Wikimedia Commons");
  });

  it("leaves Commons out for a photo from another source", () => {
    expect(
      ogCoverDescription({ authorText: "Ala", licenseLabel: "CC BY 4.0", sourceKind: "own" }),
    ).toBe("Okładka: fot. Ala, CC BY 4.0");
  });

  it("cuts a very long author to 200 characters", () => {
    const text = ogCoverDescription({
      authorText: "x".repeat(500),
      licenseLabel: "CC BY 4.0",
      sourceKind: "third_party",
    });

    expect(text).toHaveLength(200);
    expect(text.endsWith("…")).toBe(true);
  });
});
