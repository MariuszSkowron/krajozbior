import { describe, expect, it } from "vitest";

import {
  nextPlaceToVisit,
  remainingInCollectionText,
  visitRecordedText,
  type NextPlaceCandidate,
} from "@/features/album/domain/next-place";

const place = (id: string, position: number, latitude: number, longitude: number) =>
  ({ id, name: `Miejsce ${id}`, position, latitude, longitude }) satisfies NextPlaceCandidate;

const PLACES = [place("a", 1, 54.0, 18.0), place("b", 2, 54.5, 18.0), place("c", 3, 54.01, 18.0)];

describe("nextPlaceToVisit", () => {
  it("takes the nearest place that is not visited yet", () => {
    expect(nextPlaceToVisit(PLACES, new Set(["a"]), { latitude: 54.0, longitude: 18.0 })).toEqual({
      id: "c",
      name: "Miejsce c",
    });
  });

  it("takes the first one of the list when the location is not known", () => {
    expect(nextPlaceToVisit(PLACES, new Set(["a"]), null)).toEqual({ id: "b", name: "Miejsce b" });
  });

  it("breaks a tie of distance by the number in the collection", () => {
    const twins = [place("x", 2, 54, 18), place("y", 1, 54, 18)];

    expect(nextPlaceToVisit(twins, new Set(), { latitude: 54.1, longitude: 18 })?.id).toBe("y");
  });

  it("gives null when every place is visited, or the collection is empty", () => {
    expect(nextPlaceToVisit(PLACES, new Set(["a", "b", "c"]), null)).toBeNull();
    expect(nextPlaceToVisit([], new Set(), null)).toBeNull();
  });
});

describe("remainingInCollectionText", () => {
  it.each([
    [1, 3, "Zostało Ci 2 miejsca w kolekcji Mosty."],
    [2, 3, "Zostało Ci 1 miejsce w kolekcji Mosty."],
    [0, 6, "Zostało Ci 6 miejsc w kolekcji Mosty."],
  ])("%i of %i", (visited, total, text) => {
    expect(remainingInCollectionText({ visited, total }, "Mosty")).toBe(text);
  });

  it("congratulates nothing, only states that all places are visited", () => {
    expect(remainingInCollectionText({ visited: 3, total: 3 }, "Mosty")).toBe(
      "Masz wszystkie miejsca z kolekcji Mosty.",
    );
  });
});

describe("visitRecordedText", () => {
  it("names the place", () => {
    expect(visitRecordedText("Zamek w Malborku")).toBe("Zamek w Malborku jest w Twoim albumie.");
  });

  it("falls back to a general sentence without a name", () => {
    expect(visitRecordedText(undefined)).toBe("To miejsce jest w Twoim albumie.");
    expect(visitRecordedText("")).toBe("To miejsce jest w Twoim albumie.");
  });
});
