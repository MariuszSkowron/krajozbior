import { describe, expect, it } from "vitest";

import {
  cardCoverImage,
  ogCoverDescription,
  ogImageUrl,
  showsWhole,
} from "@/features/catalog/domain/collection-cover";

const ID = "0b6f3a52-7c41-4b7e-9d0a-1c2d3e4f5a6b";

describe("cardCoverImage (E4-3)", () => {
  it("is null without a cover (the card keeps the placeholder)", () => {
    expect(cardCoverImage(null)).toBeNull();
  });

  it("points at the w400 thumbnail and scales the size to 400 px", () => {
    expect(cardCoverImage({ photoId: ID, width: 1280, height: 853, altText: "Zamek" })).toEqual({
      src: `/media/p/${ID}/w400`,
      srcSet: `/media/p/${ID}/w400 400w, /media/p/${ID}/main 1280w`,
      sizes: "(min-width: 48rem) 25rem, calc(100vw - 2rem)",
      whole: false,
      width: 400,
      height: 267,
      alt: "Zamek",
    });
  });

  it("marks portrait photos and panoramas to be shown whole (Q4)", () => {
    expect(cardCoverImage({ photoId: ID, width: 800, height: 1200, altText: "P" })?.whole).toBe(
      true,
    );
    expect(cardCoverImage({ photoId: ID, width: 3000, height: 800, altText: "P" })?.whole).toBe(
      true,
    );
  });

  it("does not enlarge a photo narrower than the thumbnail", () => {
    expect(cardCoverImage({ photoId: ID, width: 300, height: 200, altText: "Mały" })).toEqual({
      src: `/media/p/${ID}/w400`,
      srcSet: undefined,
      sizes: undefined,
      whole: false,
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

  it("cuts only a very long author (with an ellipsis) and keeps the whole licence", () => {
    const text = ogCoverDescription({
      authorText: "x".repeat(500),
      licenseLabel: "CC BY-SA 3.0 PL",
      sourceKind: "commons_import",
    });

    expect(text).toHaveLength(200);
    expect(text.endsWith("…, CC BY-SA 3.0 PL, Wikimedia Commons")).toBe(true);
  });

  it("does not split a surrogate pair when cutting the author", () => {
    const text = ogCoverDescription({
      authorText: "😀".repeat(300),
      licenseLabel: "CC BY 4.0",
      sourceKind: "third_party",
    });

    expect(text.endsWith("…, CC BY 4.0")).toBe(true);
    expect(text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it("puts the licence before the author when there is no room for both", () => {
    const text = ogCoverDescription({
      authorText: "Autor",
      licenseLabel: "L".repeat(220),
      sourceKind: "third_party",
    });

    expect(text.endsWith(`, ${"L".repeat(220)}`)).toBe(true);
    expect(text).not.toContain("Autor");
  });
});

describe("showsWhole (okładka i kafelek: przycinać czy pokazać w całości)", () => {
  it("crops photos of ordinary proportions, 4:3 to 16:9 inclusive", () => {
    expect(showsWhole(1280, 853)).toBe(false);
    expect(showsWhole(400, 300)).toBe(false);
    expect(showsWhole(1600, 900)).toBe(false);
  });

  it("shows a panorama or a portrait whole", () => {
    expect(showsWhole(2400, 600)).toBe(true);
    expect(showsWhole(1601, 900)).toBe(true);
    expect(showsWhole(600, 900)).toBe(true);
    expect(showsWhole(1000, 800)).toBe(true);
  });
});
