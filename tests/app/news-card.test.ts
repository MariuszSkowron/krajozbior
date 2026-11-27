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
    expect(html).not.toContain("/media/p/abc/main");
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

  // Mini-implementacja wyboru pliku przez przeglądarkę: kandydat `srcset` o najmniejszej szerokości
  // pokrywającej szerokość miejsca (`sizes`) razy gęstość ekranu; bez `srcset` jest tylko `src`.
  const REM = 16;
  const picked = (html: string, viewport: number, density: number) => {
    const src = /<img[^>]* src="([^"]+)"/.exec(html)![1]!;
    const srcSet = /srcSet="([^"]+)"|srcset="([^"]+)"/.exec(html);
    const sizes = /sizes="([^"]+)"/.exec(html)?.[1];

    if (srcSet === null || sizes === undefined) {
      return src;
    }

    let slot = 0;

    for (const part of sizes.split(", ")) {
      const query = /^\(min-width: (\d+)rem\) (\d+)rem$/.exec(part);

      if (query === null) {
        slot = Number(/^(\d+)rem$/.exec(part)![1]) * REM;
        break;
      }
      if (viewport >= Number(query[1]) * REM) {
        slot = Number(query[2]) * REM;
        break;
      }
    }

    const candidates = (srcSet[1] ?? srcSet[2]!)
      .split(", ")
      .map((entry) => {
        const [url, width] = entry.split(" ");

        return { url: url!, width: Number.parseInt(width!, 10) };
      })
      .sort((x, y) => x.width - y.width);

    return (candidates.find((c) => c.width >= slot * density) ?? candidates.at(-1)!).url;
  };
  const withCover = (featured: boolean) =>
    renderToStaticMarkup(
      createElement(NewsCard, {
        card: { ...base, cover: { photoId: "abc", width: 1280, height: 853, altText: "x" } },
        featured,
      }),
    );

  it("takes the 400 px thumbnail on a regular card at every width and density (M-1)", () => {
    const html = withCover(false);

    expect(html).not.toContain("sizes=");
    for (const [viewport, density] of [
      [390, 1],
      [390, 3],
      [700, 2],
      [1440, 1],
      [1440, 2],
    ] as const) {
      expect(picked(html, viewport, density)).toBe("/media/p/abc/w400");
    }
  });

  it("lets the featured card take the main file from 48rem, the thumbnail on a phone (S-3)", () => {
    const html = withCover(true);

    expect(html).toContain(`sizes="${cardImageSizes(true)}"`);
    expect(picked(html, 1440, 1)).toBe("/media/p/abc/main");
    expect(picked(html, 390, 1)).toBe("/media/p/abc/w400");
    expect(picked(html, 390, 3)).toBe("/media/p/abc/w400");
  });

  it("gives no sizes when the file is not larger than the thumbnail", () => {
    const html = show({ photoId: "abc", width: 300, height: 200, altText: "x" });

    expect(html).not.toContain("sizes=");
  });
});
