import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CollectionCover } from "@/app/collections/[slug]/collection-cover";
import { CollectionCard } from "@/design-system/components/collection-card";
import type { PlaceCover } from "@/features/catalog/application/catalog-types";

const cover: PlaceCover = {
  photoId: "0b6f3a52-7c41-4b7e-9d0a-1c2d3e4f5a6b",
  width: 1280,
  height: 853,
  altText: "Zamek nad rzeką",
  title: "Zamek testowy",
  authorText: "Fikcyjny Autor",
  authorUrl: "https://commons.wikimedia.org/wiki/User:Fikcyjny",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Zamek.jpg",
  sourceKind: "commons_import",
  licenseCode: "cc-by-sa-3.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/pl/",
  licenseLabel: "CC BY-SA 3.0 PL",
};

describe("CollectionCover (nagłówek kolekcji, E4-3)", () => {
  it("shows the cover with srcset, size, its own alt text and the credit", () => {
    const html = renderToStaticMarkup(createElement(CollectionCover, { cover }));

    expect(html).toContain(`src="/media/p/${cover.photoId}/main"`);
    expect(html).toContain(
      `srcSet="/media/p/${cover.photoId}/w400 400w, /media/p/${cover.photoId}/main 1280w"`,
    );
    expect(html).toContain('width="1280"');
    expect(html).toContain('height="853"');
    expect(html).toContain('alt="Zamek nad rzeką"');
    expect(html).toContain("Fikcyjny Autor");
    expect(html).toContain("CC BY-SA 3.0 PL");
  });

  it("gives a photo not wider than the thumbnail a single file", () => {
    const html = renderToStaticMarkup(
      createElement(CollectionCover, { cover: { ...cover, width: 400, height: 267 } }),
    );

    expect(html).not.toContain("srcSet");
    expect(html).not.toContain("sizes=");
  });
});

describe("CollectionCard with a cover (E4-3)", () => {
  const props = { href: "/collections/a", title: "Kolekcja", regionLabel: "Pomorskie" };

  it("shows the photo with its alt text instead of the decorative placeholder", () => {
    const html = renderToStaticMarkup(
      createElement(CollectionCard, {
        ...props,
        cover: { src: "/media/p/x/w400", width: 400, height: 267, alt: "Most" },
      }),
    );

    expect(html).toContain('src="/media/p/x/w400"');
    expect(html).toContain('alt="Most"');
    expect(html).toContain('width="400"');
    // The cover box is no longer hidden from assistive technology (the pin icon still is).
    expect(html).not.toMatch(/class="_cover_\w+" aria-hidden/);
  });

  it("keeps the decorative placeholder without a cover", () => {
    for (const cover of [undefined, null]) {
      const html = renderToStaticMarkup(createElement(CollectionCard, { ...props, cover }));

      expect(html).not.toContain("<img");
      expect(html).toMatch(/class="_cover_\w+" aria-hidden="true"/);
    }
  });
});
