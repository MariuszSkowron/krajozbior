import { describe, expect, it } from "vitest";

import {
  landLineLabel,
  sharedPlacesNote,
} from "../../src/app/collections/[slug]/related-collections";

describe("sharedPlacesNote", () => {
  const note = (sharedPlaces: number, placeCount: number) =>
    sharedPlacesNote({ sharedPlaces, placeCount } as never);

  it.each([
    [1, 9, "1 z 9 miejsc kolekcji leży tu"],
    [2, 9, "2 z 9 miejsc kolekcji leżą tu"],
    [5, 9, "5 z 9 miejsc kolekcji leży tu"],
    [12, 30, "12 z 30 miejsc kolekcji leży tu"],
    [22, 30, "22 z 30 miejsc kolekcji leżą tu"],
  ])("says whose places and agrees the verb: %i of %i", (shared, total, expected) => {
    expect(note(shared, total)).toBe(expected);
  });

  it("does not repeat 'z' for a collection with one place", () => {
    expect(note(1, 1)).toBe("Jedyne miejsce kolekcji leży tu");
  });

  it("says 'wszystkie' when every place of the collection lies in the land", () => {
    expect(note(2, 2)).toBe("Wszystkie miejsca kolekcji leżą tu");
  });
});

describe("landLineLabel", () => {
  it.each([
    [1, 1, "Miejsce z tej kolekcji leży w krainie: "],
    [1, 2, "Miejsce z tej kolekcji leży w krainach: "],
    [3, 1, "Miejsca z tej kolekcji leżą w krainie: "],
    [3, 2, "Miejsca z tej kolekcji leżą w krainach: "],
  ])("place count %i, lands %i", (placeCount, lands, expected) => {
    expect(landLineLabel(placeCount, lands)).toBe(expected);
  });
});
