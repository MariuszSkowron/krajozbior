import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NewsPhotoCredit } from "@/app/news/news-photo-credit";
import type { CollectionBanner } from "@/features/catalog/application/catalog-types";

const photo: CollectionBanner = {
  photoId: "ph1",
  width: 1280,
  height: 853,
  altText: "Most",
  title: "Most testowy",
  authorText: "Fikcyjny Autor",
  authorUrl: "https://commons.wikimedia.org/wiki/User:Fikcyjny",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Most.jpg",
  sourceKind: "commons_import",
  licenseCode: "cc-by-sa-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  licenseLabel: "CC BY-SA 4.0",
  placeId: "pl-1",
  placeName: "Stary Most",
};

const show = (value: CollectionBanner) =>
  renderToStaticMarkup(createElement(NewsPhotoCredit, { photo: value }));

describe("NewsPhotoCredit (D-58 pkt 3, jedna linia)", () => {
  it("is one line: place (link), author (link), source, licence (link), 'zdjęcie zmniejszone'", () => {
    const html = show(photo);

    expect(html.match(/<p/g)).toHaveLength(1);
    expect(html).toContain('<a href="/places/pl-1">Stary Most</a> · fot. ');
    expect(html).toContain(
      '<a href="https://commons.wikimedia.org/wiki/User:Fikcyjny" rel="noopener noreferrer">Fikcyjny Autor</a>',
    );
    expect(html).toContain(
      '<a href="https://commons.wikimedia.org/wiki/File:Most.jpg" rel="noopener noreferrer">Wikimedia Commons</a>',
    );
    expect(html).toContain(
      '<a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener noreferrer">CC BY-SA 4.0</a> · zdjęcie zmniejszone',
    );
    expect(html).not.toContain("Autor:");
    expect(html).not.toContain("Most testowy");
  });

  it("leaves out the source and the note about changes when there is none (public domain)", () => {
    const html = show({
      ...photo,
      sourceUrl: null,
      authorUrl: null,
      licenseCode: "public-domain",
      licenseUrl: null,
      licenseLabel: "Domena publiczna",
    });

    expect(html).toContain("· fot. Fikcyjny Autor · Domena publiczna");
    expect(html).not.toContain("zmniejszone");
    expect(html).not.toContain("Wikimedia Commons");
  });

  it("shows text from outside as text", () => {
    const html = show({ ...photo, placeName: "<b>Most</b>", authorText: "<i>x</i>" });

    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>");
  });
});
