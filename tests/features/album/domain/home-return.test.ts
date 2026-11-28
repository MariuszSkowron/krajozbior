import { describe, expect, it } from "vitest";

import {
  incompleteCollections,
  remainingCollections,
  remainingLabel,
  saveNudgeText,
} from "@/features/album/domain/home-return";

const collection = (id: string, visited: number, total: number) => ({
  id,
  slug: `slug-${id}`,
  title: `Kolekcja ${id}`,
  progress:
    total === 0 ? ({ kind: "empty" } as const) : ({ kind: "progress", visited, total } as const),
});

describe("incompleteCollections", () => {
  it("leaves out complete and empty collections and keeps one more than three shown", () => {
    const result = incompleteCollections([
      collection("a", 3, 3),
      collection("b", 0, 0),
      collection("c", 1, 3),
      collection("d", 0, 2),
      collection("e", 1, 4),
      collection("f", 2, 4),
      collection("g", 2, 5),
    ]);

    expect(result.map(({ id }) => id)).toEqual(["c", "d", "e", "f"]);
  });
});

describe("remainingCollections", () => {
  it("counts what is left and names the first unvisited places in list order", () => {
    const rows = remainingCollections(
      [collection("a", 1, 4), collection("b", 0, 1), collection("c", 2, 2)],
      [
        { collectionId: "a", name: "Trzecie", position: 3 },
        { collectionId: "a", name: "Drugie", position: 2 },
        { collectionId: "a", name: "Czwarte", position: 4 },
        { collectionId: "b", name: "Jedyne", position: 1 },
      ],
    );

    expect(rows).toEqual([
      { slug: "slug-a", title: "Kolekcja a", remaining: 3, names: ["Drugie", "Trzecie"] },
      { slug: "slug-b", title: "Kolekcja b", remaining: 1, names: ["Jedyne"] },
    ]);
  });

  it("gives a row without names when none were read", () => {
    expect(remainingCollections([collection("a", 0, 2)], [])).toEqual([
      { slug: "slug-a", title: "Kolekcja a", remaining: 2, names: [] },
    ]);
  });

  it("is empty when everything is complete", () => {
    expect(remainingCollections([collection("a", 2, 2)], [])).toEqual([]);
  });
});

describe("texts", () => {
  it("writes the count after a colon so the verb never changes", () => {
    expect(remainingLabel(1)).toBe("do odkrycia: 1");
    expect(remainingLabel(5)).toBe("do odkrycia: 5");
  });

  it("writes the nudge without gender", () => {
    expect(
      saveNudgeText({ id: "x", slug: "x", title: "Mosty i zamki", visited: 1, total: 3 }),
    ).toBe("Masz 1 z 3 miejsc kolekcji Mosty i zamki. Zapisz ją, żeby widzieć postęp.");
  });

  it("does not promise progress for a collection visited in full", () => {
    expect(
      saveNudgeText({ id: "x", slug: "x", title: "Mosty i zamki", visited: 3, total: 3 }),
    ).toBe("Masz wszystkie 3 miejsca kolekcji Mosty i zamki. Zapisz ją w swoich kolekcjach.");
    expect(saveNudgeText({ id: "x", slug: "x", title: "Młyn", visited: 1, total: 1 })).toBe(
      "Masz jedyne miejsce kolekcji Młyn. Zapisz ją w swoich kolekcjach.",
    );
    expect(saveNudgeText({ id: "x", slug: "x", title: "Szlak", visited: 5, total: 5 })).toBe(
      "Masz wszystkie 5 miejsc kolekcji Szlak. Zapisz ją w swoich kolekcjach.",
    );
  });
});
