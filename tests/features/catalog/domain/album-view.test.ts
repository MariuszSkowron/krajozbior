import { describe, expect, it } from "vitest";

import {
  albumHref,
  countByState,
  filterByState,
  formatUpdateDate,
  parseSelectedPlace,
  parseView,
  parseStateFilter,
  shortenDescription,
  type VisitKind,
} from "@/features/catalog/domain/album-view";

const PLACE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("parseStateFilter", () => {
  it.each([
    ["odwiedzone", "odwiedzone"],
    ["do-odwiedzenia", "do-odwiedzenia"],
    ["wszystkie", "wszystkie"],
    [undefined, "wszystkie"],
    ["", "wszystkie"],
    ["ODWIEDZONE", "wszystkie"],
    ["cokolwiek", "wszystkie"],
  ])("reads %s as %s", (raw, expected) => {
    expect(parseStateFilter(raw)).toBe(expected);
  });

  it("takes the first of a repeated parameter", () => {
    expect(parseStateFilter(["odwiedzone", "do-odwiedzenia"])).toBe("odwiedzone");
    expect(parseStateFilter([])).toBe("wszystkie");
  });
});

describe("parseSelectedPlace", () => {
  it("accepts a UUID (lower-cased) and nothing else", () => {
    expect(parseSelectedPlace(PLACE)).toBe(PLACE);
    expect(parseSelectedPlace(PLACE.toUpperCase())).toBe(PLACE);
    expect(parseSelectedPlace(["not-a-uuid", PLACE])).toBeNull();
    expect(parseSelectedPlace(undefined)).toBeNull();
    expect(parseSelectedPlace("")).toBeNull();
    expect(parseSelectedPlace("1; drop table places")).toBeNull();
  });
});

describe("the state of the places", () => {
  const kinds = new Map<string, VisitKind>([
    ["a", "on_site"],
    ["c", "past"],
    ["z", "past"], // a visit of a place that is not in this list counts nowhere
  ]);
  const places = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("counts all, visited (any kind) and not yet visited", () => {
    expect(countByState(["a", "b", "c", "d"], kinds)).toEqual({
      wszystkie: 4,
      odwiedzone: 2,
      "do-odwiedzenia": 2,
    });
    expect(countByState([], kinds)).toEqual({ wszystkie: 0, odwiedzone: 0, "do-odwiedzenia": 0 });
  });

  it("filters the places and keeps their order", () => {
    expect(filterByState(places, "wszystkie", kinds)).toBe(places);
    expect(filterByState(places, "odwiedzone", kinds).map((p) => p.id)).toEqual(["a", "c"]);
    expect(filterByState(places, "do-odwiedzenia", kinds).map((p) => p.id)).toEqual(["b", "d"]);
  });
});

describe("albumHref", () => {
  it("leaves out the defaults", () => {
    expect(albumHref("kolekcja-1", {})).toBe("/collections/kolekcja-1");
    expect(albumHref("kolekcja-1", { stan: "wszystkie", miejsce: null })).toBe(
      "/collections/kolekcja-1",
    );
  });

  it("writes the filter and the place", () => {
    expect(albumHref("kolekcja-1", { stan: "odwiedzone" })).toBe(
      "/collections/kolekcja-1?stan=odwiedzone",
    );
    expect(albumHref("kolekcja-1", { miejsce: PLACE })).toBe(
      `/collections/kolekcja-1?miejsce=${PLACE}`,
    );
    expect(albumHref("kolekcja-1", { stan: "do-odwiedzenia", miejsce: PLACE })).toBe(
      `/collections/kolekcja-1?stan=do-odwiedzenia&miejsce=${PLACE}`,
    );
  });
});

describe("parseView and the map view in albumHref (E12-5)", () => {
  it("knows only the map; anything else is the cards", () => {
    expect(parseView("mapa")).toBe("mapa");
    expect(parseView(["mapa", "karty"])).toBe("mapa");
    expect(parseView("karty")).toBe("karty");
    expect(parseView("MAPA")).toBe("karty");
    expect(parseView(undefined)).toBe("karty");
  });

  it("writes the map view and keeps the other parts", () => {
    expect(albumHref("kolekcja-1", { widok: "karty" })).toBe("/collections/kolekcja-1");
    expect(albumHref("kolekcja-1", { widok: "mapa" })).toBe("/collections/kolekcja-1?widok=mapa");
    expect(albumHref("kolekcja-1", { widok: "mapa", stan: "odwiedzone", miejsce: PLACE })).toBe(
      `/collections/kolekcja-1?widok=mapa&stan=odwiedzone&miejsce=${PLACE}`,
    );
  });
});

describe("formatUpdateDate", () => {
  it("writes the day in Polish time as DD.MM.RRRR", () => {
    expect(formatUpdateDate(new Date("2026-11-18T10:00:00Z"))).toBe("18.11.2026");
    expect(formatUpdateDate(new Date("2026-03-05T12:00:00Z"))).toBe("05.03.2026");
    // 23:30 UTC is already the next day in Poland.
    expect(formatUpdateDate(new Date("2026-11-18T23:30:00Z"))).toBe("19.11.2026");
  });
});

describe("shortenDescription", () => {
  it("keeps a short text whole (trimmed)", () => {
    expect(shortenDescription("  Krótki opis. ")).toBe("Krótki opis.");
  });

  it("cuts a long text at a word and adds an ellipsis", () => {
    const text = "słowo ".repeat(100);
    const short = shortenDescription(text, 50);

    expect(short.endsWith("…")).toBe(true);
    expect(short.length).toBeLessThanOrEqual(51);
    expect(short).toBe(`${"słowo ".repeat(8).trimEnd()}…`);
  });

  it("cuts inside a very long word when there is no earlier space", () => {
    expect(shortenDescription("a".repeat(400), 10)).toBe(`${"a".repeat(10)}…`);
  });
});
