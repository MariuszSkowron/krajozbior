import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlacePhoto } from "@/app/places/[placeId]/place-photo";
import type { PlaceCover } from "@/features/catalog/application/catalog-types";

const cover: PlaceCover = {
  photoId: "0b6f3a52-7c41-4b7e-9d0a-1c2d3e4f5a6b",
  width: 1280,
  height: 853,
  altText: "Zamek w Malborku",
  title: "Zamek w Malborku",
  authorText: "Fikcyjny Autor",
  authorUrl: "https://commons.wikimedia.org/wiki/User:Fikcyjny",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Zamek.jpg",
  sourceKind: "commons_import",
  licenseCode: "cc-by-sa-3.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/pl/",
  licenseLabel: "CC BY-SA 3.0 PL",
};

const render = (value: PlaceCover) =>
  renderToStaticMarkup(createElement(PlacePhoto, { cover: value, placeName: "Malbork, zamek" }));

describe("PlacePhoto", () => {
  it("shows the cover with srcset, size and alt text", () => {
    const html = render(cover);

    expect(html).toContain(`src="/media/p/${cover.photoId}/main"`);
    expect(html).toContain(
      `srcSet="/media/p/${cover.photoId}/w400 400w, /media/p/${cover.photoId}/main 1280w"`,
    );
    expect(html).toContain('width="1280"');
    expect(html).toContain('height="853"');
    // The alt text is the name of the place, not the title (the caption already says it).
    expect(html).toContain('alt="Malbork, zamek"');
    expect(html).not.toContain('alt="Zamek w Malborku"');
  });

  it("heads the credit of a public domain photo with Status, not Licencja", () => {
    const html = render({
      ...cover,
      licenseCode: "public-domain",
      licenseLabel: "domena publiczna",
    });

    expect(html).toContain("Status:");
    expect(html).not.toContain("Licencja:");
  });

  it("gives a photo not wider than the thumbnail a single file", () => {
    const html = render({ ...cover, width: 400 });

    expect(html).not.toContain("srcSet");
    expect(html).not.toContain("sizes=");
  });

  it("shows the full credit with links to author, Commons file and exact licence", () => {
    const html = render(cover);

    expect(html).toContain('<a href="https://commons.wikimedia.org/wiki/User:Fikcyjny"');
    expect(html).toContain(">Fikcyjny Autor</a>");
    expect(html).toContain('<a href="https://commons.wikimedia.org/wiki/File:Zamek.jpg"');
    expect(html).toContain(">Wikimedia Commons</a>");
    expect(html).toContain('<a href="https://creativecommons.org/licenses/by-sa/3.0/pl/"');
    expect(html).toContain(">CC BY-SA 3.0 PL</a>");
    expect(html).toContain("Zdjęcie zmniejszone i skompresowane, zapisane w formacie WebP.");
    expect(html).toContain("Ta kopia jest dostępna na licencji CC BY-SA 3.0 PL.");
    expect(html).toContain("<figcaption");
  });

  it("leaves out the links and the title it does not have, and escapes the author", () => {
    const html = render({
      ...cover,
      title: null,
      authorUrl: null,
      sourceUrl: null,
      licenseUrl: null,
      authorText: "<script>x</script>",
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("Wikimedia Commons");
    expect(html).not.toContain("<a ");
  });

  describe("the slot above the photo (R3)", () => {
    const withState = (props: { number?: number; state?: "undiscovered" | "visited" }) =>
      renderToStaticMarkup(
        createElement(PlacePhoto, { cover, placeName: "Malbork, zamek", ...props }),
      );

    it("names the number and 'Do odkrycia' for a place the explorer has not visited", () => {
      const html = withState({ number: 1, state: "undiscovered" });

      expect(html).toContain(">01<");
      expect(html).toContain("Do odkrycia");
    });

    it("names 'Odwiedzone' for a visited place", () => {
      const html = withState({ number: 12, state: "visited" });

      expect(html).toContain(">12<");
      expect(html).toContain("Odwiedzone");
      expect(html).not.toContain("Do odkrycia");
    });

    it("shows a guest the photo without a state row", () => {
      const html = withState({});

      expect(html).not.toContain("Do odkrycia");
      expect(html).not.toContain("Odwiedzone");
      expect(html).toContain(`src="/media/p/${cover.photoId}/main"`);
    });
  });
});
