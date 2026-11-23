import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlaceTile, type TilePlace } from "@/app/collections/[slug]/place-tile";

const place: TilePlace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Zamek w Pęzinie",
  address: "Pęzino, woj. zachodniopomorskie",
  position: 2,
  thumb: { photoId: "0b6f3a52-7c41-4b7e-9d0a-1c2d3e4f5a6b", width: 1280, height: 853 },
};

const render = (props: Partial<Parameters<typeof PlaceTile>[0]> = {}) =>
  renderToStaticMarkup(
    createElement("ol", null, createElement(PlaceTile, { place, state: null, ...props })),
  );

describe("PlaceTile (kafelek miejsca w kolekcji)", () => {
  it("links to the place and shows the padded number, the name and the address", () => {
    const html = render();

    expect(html).toContain(`href="/places/${place.id}"`);
    expect(html).toContain(">02<");
    expect(html).toContain(">Zamek w Pęzinie<");
    expect(html).toContain(">Pęzino, woj. zachodniopomorskie<");
  });

  it("gives a guest no state, no badge and no dimming", () => {
    const html = render({ state: null });

    expect(html).not.toContain("Odwiedzone");
    expect(html).not.toContain("Do odwiedzenia");
    expect(html).not.toContain("Z przeszłości");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain('aria-hidden="true"');
  });

  it("marks a visited place with the word and a decorative tick", () => {
    for (const [state, word] of [
      ["on_site", "Odwiedzone"],
      ["past", "Z przeszłości"],
    ] as const) {
      const html = render({ state });

      expect(html).toContain(`>${word}</span>`);
      // The tick is decorative (hidden from a screen reader): the state is in the word.
      expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*><svg/);
      expect(html).not.toContain("Do odwiedzenia");
    }
  });

  it("dims a place the explorer has not visited and says so in words", () => {
    const html = render({ state: "todo" });

    expect(html).toContain("Do odwiedzenia");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain('aria-hidden="true"');
  });

  it("keeps a tile without a photo and without an address whole", () => {
    const html = render({ place: { ...place, thumb: null, address: "" } });

    expect(html).not.toContain("<img");
    expect(html).not.toContain("Pęzino");
    expect(html).toContain(">Zamek w Pęzinie<");
  });

  it("is a label of the checkbox in the picking mode, not a link", () => {
    const html = render({ state: "todo", pick: createElement("input", { type: "checkbox" }) });

    expect(html).toContain("<label");
    expect(html).not.toContain("<a ");
    expect(html).toContain('type="checkbox"');
  });
});
