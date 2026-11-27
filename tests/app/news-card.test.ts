import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/news/application/public-news", () => ({
  listPublicNews: vi.fn(),
  getPublicNews: vi.fn(),
}));

const { NewsCard, cardImageSizes } = await import("@/app/news/news-parts");

const base = {
  slug: "jak-zbierac",
  kind: "guide" as const,
  title: "Jak zbierać miejsca",
  lead: "Krótki tekst.",
  publishedAt: new Date("2026-11-20T10:00:00Z"),
  eventStartsOn: null,
  eventEndsOn: null,
  organization: { name: "Krajozbiór — redakcja", slug: "krajozbior-redakcja" },
  verification: "editorial" as const,
};

const show = (cover: { photoId: string; width: number; height: number; altText: string } | null) =>
  renderToStaticMarkup(createElement(NewsCard, { card: { ...base, cover }, featured: false }));

describe("NewsCard", () => {
  it("shows the thumbnail as a decoration, without a credit, with the title as the only link", () => {
    const html = show({ photoId: "abc", width: 1280, height: 853, altText: "Most" });

    expect(html).toContain('src="/media/p/abc/w400"');
    expect(html).toContain("/media/p/abc/main 1280w");
    expect(html).toContain('alt=""');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain("<figcaption");
    expect(html).not.toContain("Most");
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("shows a panorama whole", () => {
    expect(show({ photoId: "abc", width: 2000, height: 500, altText: "Pano" })).toMatch(
      /<img class="[^"]*imageWhole/,
    );
  });

  it("without a photo is a text card: no image field at all, a single link (S-1)", () => {
    const html = show(null);

    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/class="[^"]*\bimage\b/);
    expect(html).toMatch(/<article class="[^"]*plain/);
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("with a photo has the image field and is not a text card", () => {
    const html = show({ photoId: "abc", width: 1280, height: 853, altText: "x" });

    expect(html).toMatch(/<div class="[^"]*image/);
    expect(html).not.toMatch(/<article class="[^"]*plain/);
  });

  it("asks for a wider image on the featured card", () => {
    const html = renderToStaticMarkup(
      createElement(NewsCard, {
        card: { ...base, cover: { photoId: "abc", width: 1280, height: 853, altText: "x" } },
        featured: true,
      }),
    );

    expect(html).toContain(`sizes="${cardImageSizes(true)}"`);
  });

  it("asks for the main file from 48rem (the column is wider than the 400 px thumbnail), the thumbnail on a phone (S-3)", () => {
    const html = renderToStaticMarkup(
      createElement(NewsCard, {
        card: { ...base, cover: { photoId: "abc", width: 1280, height: 853, altText: "x" } },
        featured: false,
      }),
    );

    expect(html).toContain('sizes="(min-width: 48rem) 30rem, 8rem"');
    // 30rem = 480 px > 400 px of the thumbnail, so a desktop browser takes `main`; 8rem = 128 px
    // (x3 = 384 px) is covered by the thumbnail.
    expect(cardImageSizes(false)).toMatch(/^\(min-width: 48rem\) (\d+)rem, (\d+)rem$/);
    expect(Number(/ (\d+)rem,/.exec(cardImageSizes(false))?.[1]) * 16).toBeGreaterThan(400);
    expect(Number(/, (\d+)rem$/.exec(cardImageSizes(false))?.[1]) * 16 * 3).toBeLessThanOrEqual(
      400,
    );
  });

  it("gives no sizes when the file is not larger than the thumbnail", () => {
    const html = show({ photoId: "abc", width: 300, height: 200, altText: "x" });

    expect(html).not.toContain("sizes=");
  });
});
