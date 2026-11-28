import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NewCollectionsSection } from "@/app/home/return-sections";
import type { NewCollection } from "@/features/catalog/application/catalog-types";

function collection(extraRegions: NewCollection["extraRegions"]): NewCollection {
  return {
    id: "c1",
    slug: "kolekcja",
    title: "Kolekcja testowa",
    region: "mazowieckie",
    extraRegions,
    organization: { name: "Organizacja" },
    placeCount: 4,
    cover: null,
    firstPublishedAt: new Date("2026-11-20T10:00:00Z"),
  };
}

describe("NewCollectionsSection", () => {
  it("shows only the main region of a collection without extra regions", () => {
    const html = renderToStaticMarkup(NewCollectionsSection({ collections: [collection([])] }));

    expect(html).toContain("Mazowieckie");
    expect(html).not.toContain("Pomorskie");
  });

  it("shows the main and the extra regions of a collection", () => {
    const html = renderToStaticMarkup(
      NewCollectionsSection({ collections: [collection(["pomorskie"])] }),
    );

    expect(html).toContain("Mazowieckie");
    expect(html).toContain("Pomorskie");
  });
});
