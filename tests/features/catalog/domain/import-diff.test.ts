import { describe, expect, it } from "vitest";

import {
  decideCollection,
  decidePlace,
  diffComposition,
  sameIds,
  type ImportKeyState,
  type StoredCollection,
  type StoredPlace,
} from "@/features/catalog/domain/import-diff";
import type { PlaceInput } from "@/features/catalog/domain/place";

const wantedPlace: PlaceInput = {
  name: "Miejsce",
  description: "Opis",
  address: "Adres",
  accessInfo: "Dostęp",
  latitude: 54.1,
  longitude: 18.2,
  visitRadiusM: 200,
};
const placeKey: ImportKeyState = { entityId: "p1", importedVersion: 2, importedPlaces: null };
const storedPlace = (over: Partial<PlaceInput> = {}, version = 2): StoredPlace => ({
  version,
  content: { ...wantedPlace, ...over },
});

describe("decidePlace", () => {
  it("creates a place that was never loaded", () => {
    expect(decidePlace(undefined, null, wantedPlace)).toBe("create");
  });

  it("keeps a place the owner deleted", () => {
    expect(decidePlace(placeKey, null, wantedPlace)).toBe("kept_manual_delete");
  });

  it("keeps a place whose version moved", () => {
    expect(decidePlace(placeKey, storedPlace({}, 3), wantedPlace)).toBe("kept_manual_edit");
  });

  it("does nothing when the content is the same", () => {
    expect(decidePlace(placeKey, storedPlace(), wantedPlace)).toBe("noop");
  });

  it.each([
    { name: "Inne" },
    { description: "Inny" },
    { address: "Inny" },
    { accessInfo: "Inny" },
    { latitude: 54.2 },
    { longitude: 18.3 },
    { visitRadiusM: 300 },
  ])("updates when a field differs (%o)", (over) => {
    expect(decidePlace(placeKey, storedPlace(over), wantedPlace)).toBe("update");
  });
});

const wantedCollection = { title: "T", summary: "S", region: "pomorskie" } as const;
const colKey: ImportKeyState = { entityId: "c1", importedVersion: 1, importedPlaces: ["a", "b"] };
const storedCollection = (over: Partial<StoredCollection> = {}): StoredCollection => ({
  version: 1,
  status: "draft",
  firstPublishedAt: null,
  content: wantedCollection,
  placeIds: ["a", "b"],
  ...over,
});

describe("decideCollection", () => {
  it("creates a collection that was never loaded", () => {
    expect(decideCollection(undefined, null, wantedCollection)).toEqual({
      content: "create",
      composition: "sync",
    });
  });

  it("keeps a collection the owner deleted", () => {
    expect(decideCollection(colKey, null, wantedCollection)).toEqual({
      content: "kept_manual_delete",
      composition: "kept_manual_delete",
    });
  });

  it("leaves a published collection alone", () => {
    expect(
      decideCollection(
        colKey,
        storedCollection({ status: "published", firstPublishedAt: new Date() }),
        wantedCollection,
      ),
    ).toEqual({
      content: "skipped_already_published",
      composition: "skipped_already_published",
    });
  });

  it("leaves a withdrawn draft that was published once alone, like a published one (L3)", () => {
    expect(
      decideCollection(colKey, storedCollection({ firstPublishedAt: new Date("2026-01-01") }), {
        ...wantedCollection,
        title: "Nowy tytuł",
      }),
    ).toEqual({
      content: "skipped_already_published",
      composition: "skipped_already_published",
    });
  });

  it("reports an edit made in the panel after publication, published or withdrawn", () => {
    for (const over of [
      { status: "published" as const, version: 5, firstPublishedAt: new Date() },
      { version: 5, firstPublishedAt: new Date() },
    ]) {
      expect(decideCollection(colKey, storedCollection(over), wantedCollection)).toEqual({
        content: "kept_manual_edit",
        composition: "kept_manual_edit",
      });
    }
  });

  it("does nothing for an untouched collection equal to the file", () => {
    expect(decideCollection(colKey, storedCollection(), wantedCollection)).toEqual({
      content: "noop",
      composition: "sync",
    });
  });

  it("updates the text of an untouched draft", () => {
    for (const content of [
      { ...wantedCollection, title: "X" },
      { ...wantedCollection, summary: "X" },
      { ...wantedCollection, region: "slaskie" as const },
    ]) {
      expect(
        decideCollection(colKey, storedCollection({ content }), wantedCollection).content,
      ).toBe("update");
    }
  });

  it("keeps a draft whose version moved, composition by the stored places", () => {
    expect(decideCollection(colKey, storedCollection({ version: 2 }), wantedCollection)).toEqual({
      content: "kept_manual_edit",
      composition: "kept_manual_edit",
    });
  });

  it("keeps the composition when the places changed without a new version", () => {
    for (const placeIds of [["b", "a"], ["a"], ["a", "b", "c"]]) {
      expect(decideCollection(colKey, storedCollection({ placeIds }), wantedCollection)).toEqual({
        content: "noop",
        composition: "kept_manual_edit",
      });
    }
  });

  it("treats a missing stored list as empty", () => {
    const key = { ...colKey, importedPlaces: null };

    expect(
      decideCollection(key, storedCollection({ placeIds: [] }), wantedCollection).composition,
    ).toBe("sync");
  });
});

describe("sameIds and diffComposition", () => {
  it("compares lists in order", () => {
    expect(sameIds(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameIds(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameIds(["a"], ["a", "b"])).toBe(false);
  });

  it("finds nothing to do for equal lists", () => {
    expect(diffComposition(["a", "b"], ["a", "b"])).toEqual({
      remove: [],
      add: [],
      reorder: false,
    });
  });

  it("removes, appends and reorders", () => {
    expect(diffComposition(["a", "x", "c"], ["c", "a", "b"])).toEqual({
      remove: ["x"],
      add: ["b"],
      reorder: true,
    });
  });

  it("needs no reorder when the appended places already close the list", () => {
    expect(diffComposition(["a"], ["a", "b", "c"])).toEqual({
      remove: [],
      add: ["b", "c"],
      reorder: false,
    });
  });
});
