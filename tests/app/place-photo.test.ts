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
  renderToStaticMarkup(createElement(PlacePhoto, { cover: value }));

describe("PlacePhoto", () => {
  it("shows the cover with srcset, size and alt text", () => {
    const html = render(cover);

    expect(html).toContain(`src="/media/p/${cover.photoId}/main"`);
    expect(html).toContain(
      `srcSet="/media/p/${cover.photoId}/w400 400w, /media/p/${cover.photoId}/main 1280w"`,
    );
    expect(html).toContain('width="1280"');
    expect(html).toContain('height="853"');
    expect(html).toContain('alt="Zamek w Malborku"');
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
});
