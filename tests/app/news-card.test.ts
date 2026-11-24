import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/news/application/public-news", () => ({
  listPublicNews: vi.fn(),
  getPublicNews: vi.fn(),
}));

const { NewsCard } = await import("@/app/news/news-parts");

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

  it("without a photo keeps a hidden placeholder field and no image", () => {
    const html = show(null);

    expect(html).not.toContain("<img");
    expect(html).toMatch(/<div class="[^"]*image[^"]*" aria-hidden="true"/);
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("asks for a wider image on the featured card", () => {
    const html = renderToStaticMarkup(
      createElement(NewsCard, {
        card: { ...base, cover: { photoId: "abc", width: 1280, height: 853, altText: "x" } },
        featured: true,
      }),
    );

    expect(html).toContain("(min-width: 48rem) 42rem, 100vw");
  });
});
