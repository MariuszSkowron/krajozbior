import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CollectionCover, CoverProgress } from "@/app/collections/[slug]/collection-cover";
import { CollectionCard } from "@/design-system/components/collection-card";
import type { CollectionBanner } from "@/features/catalog/application/catalog-types";

const cover: CollectionBanner = {
  placeId: "4f6e1c2a-9b3d-4a7e-8c15-0d2e3f4a5b6c",
  placeName: "Zamek testowy",
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

const eyebrow = "Kolekcja · Pomorskie";
const title = createElement("h1", null, "Zamki");
const show = (value: CollectionBanner | null) =>
  createElement(CollectionCover, { cover: value, eyebrow }, title);

describe("CollectionCover (nagłówek kolekcji, E4-3, R3)", () => {
  it("puts the eyebrow and the title on the photo, with the credit below it", () => {
    const html = renderToStaticMarkup(show(cover));

    expect(html).toContain("<figure");
    expect(html).toContain(">Kolekcja · Pomorskie</p>");
    expect(html).toContain("<h1>Zamki</h1>");
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("<h1>"));
    expect(html.indexOf("<h1>")).toBeLessThan(html.indexOf("<figcaption"));
  });

  it("signs the photo with one short line, the full credit stays on the place page (D-58)", () => {
    const html = renderToStaticMarkup(show(cover));
    const caption = html.slice(html.indexOf("<figcaption"));
    // Znaczniki wycinamy do skutku (wzorzec akceptowany przez CodeQL; tu i tak to statyczny HTML z testu).
    let text = caption;
    for (let previous = ""; previous !== text;) {
      previous = text;
      text = text.replace(/<[^>]*>/g, "");
    }

    expect(text).toBe(
      "Zamek testowy · fot. Fikcyjny Autor, Wikimedia Commons · CC BY-SA 3.0 PL · zdjęcie zmniejszone",
    );
    expect(caption.match(/<p[ >]/g)).toHaveLength(1);
    expect(caption).toContain(`href="/places/${cover.placeId}"`);
    expect(caption).toContain('href="https://creativecommons.org/licenses/by-sa/3.0/pl/"');
    expect(caption).toContain('href="https://commons.wikimedia.org/wiki/File:Zamek.jpg"');
    expect(html).not.toContain("Tę kopię udostępniamy");
    expect(html).not.toContain("WebP");
  });

  it("gives a panorama and a portrait the same alt text and size as any photo", () => {
    // Cropping or showing whole is a style choice (rule: showsWhole, tested in the domain).
    for (const [width, height] of [
      [2400, 600],
      [600, 900],
    ] as const) {
      const html = renderToStaticMarkup(show({ ...cover, width, height }));

      expect(html).toContain('alt="Zamek nad rzeką"');
      expect(html).toContain(`width="${width}"`);
      expect(html).toContain(`height="${height}"`);
    }
  });

  it("keeps the title readable without a photo: a placeholder cover, no figure, no credit", () => {
    const html = renderToStaticMarkup(show(null));

    expect(html).not.toContain("<figure");
    expect(html).not.toContain("<img");
    expect(html).toContain("<h1>Zamki</h1>");
  });

  it("shows the cover with srcset, size, its own alt text and the credit", () => {
    const html = renderToStaticMarkup(show(cover));

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
    const html = renderToStaticMarkup(show({ ...cover, width: 400, height: 267 }));

    expect(html).not.toContain("srcSet");
    expect(html).not.toContain("sizes=");
  });
});

describe("CoverProgress (postęp odkrywcy na okładce)", () => {
  const label = "Twój postęp w kolekcji Zamki";

  it("gives a screen reader the whole sentence and hides the visual pieces", () => {
    const html = renderToStaticMarkup(
      createElement(CoverProgress, { visited: 5, total: 13, label }),
    );

    expect(html).toContain("5/13 odwiedzone");
    expect(html).toContain('<progress class="_bar_');
    expect(html).toContain('value="5"');
    expect(html).toContain('max="13"');
    expect(html).toContain(`aria-label="${label}"`);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
  });

  it("shows neither the number nor the bar for a collection without places", () => {
    expect(
      renderToStaticMarkup(createElement(CoverProgress, { visited: 0, total: 0, label })),
    ).toBe("");
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
      expect(html).toMatch(/class="_cover_\w+ _coverEmpty_\w+" aria-hidden="true"/);
    }
  });
});
