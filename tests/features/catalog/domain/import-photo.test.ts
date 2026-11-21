import { describe, expect, it } from "vitest";

import type { ImportKeyState } from "@/features/catalog/domain/import-diff";
import type { ImportImage } from "@/features/catalog/domain/import-file";
import {
  decidePhoto,
  photoContentOf,
  photoImportKey,
  type PhotoContent,
  type StoredPhoto,
} from "@/features/catalog/domain/import-photo";

const image: ImportImage = {
  commonsFile: "Przykład (1).jpg",
  title: "Tytuł zdjęcia",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Przyk%C5%82ad_(1).jpg",
  authorText: "Autor Testowy",
  authorUrl: "https://commons.wikimedia.org/wiki/User:Autor",
  sourceWidth: 3000,
  license: {
    code: "cc-by-sa-4.0",
    label: "CC BY-SA 4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  retrievedAt: "2026-11-20T00:00:00Z",
};

const wanted = photoContentOf(image);
const key: ImportKeyState = { entityId: "id", importedVersion: 1, importedPlaces: null };

const stored = (overrides: Partial<StoredPhoto["content"]> = {}, version = 1): StoredPhoto => {
  const { commonsFile: _file, ...content } = wanted;

  void _file;

  return { version, content: { ...content, ...overrides } };
};

describe("photoContentOf", () => {
  it("maps the block and uses the title as the alternative text", () => {
    expect(wanted).toMatchObject({
      commonsFile: "Przykład (1).jpg",
      altText: "Tytuł zdjęcia",
      sourceUrl: image.pageUrl,
      licenseCode: "cc-by-sa-4.0",
      licenseLabel: "CC BY-SA 4.0",
      sourceWidth: 3000,
    });
  });

  it("cuts a long title for the alternative text only", () => {
    const content = photoContentOf({ ...image, title: "x".repeat(300) });

    expect(content.altText).toHaveLength(200);
    expect(content.title).toHaveLength(300);
  });
});

describe("photoImportKey", () => {
  it("is stable, fits the key pattern of the database and tells places and files apart", () => {
    const first = photoImportKey("wd:Q1", "Plik.jpg");

    expect(first).toMatch(/^img:[0-9a-f]{40}$/);
    expect(photoImportKey("wd:Q1", "Plik.jpg")).toBe(first);
    expect(photoImportKey("wd:Q2", "Plik.jpg")).not.toBe(first);
    expect(photoImportKey("wd:Q1", "Inny.jpg")).not.toBe(first);
  });
});

describe("decidePhoto", () => {
  it("creates a photo that was never loaded", () => {
    expect(decidePhoto(undefined, null, wanted)).toBe("create");
  });

  it("does not bring back a photo the curator deleted", () => {
    expect(decidePhoto(key, null, wanted)).toBe("kept_manual_delete");
  });

  it("keeps a photo edited by hand (another version)", () => {
    expect(decidePhoto(key, stored({}, 2), wanted)).toBe("kept_manual_edit");
  });

  it("does nothing when nothing changed", () => {
    expect(decidePhoto(key, stored(), wanted)).toBe("noop");
  });

  it.each<[string, Partial<PhotoContent>]>([
    ["altText", { altText: "Inny" }],
    ["title", { title: "Inny" }],
    ["authorText", { authorText: "Inny" }],
    ["authorUrl", { authorUrl: null }],
    ["sourceUrl", { sourceUrl: "https://commons.wikimedia.org/wiki/File:Inny.jpg" }],
    ["licenseCode", { licenseCode: "cc-by-4.0" }],
    ["licenseUrl", { licenseUrl: "https://creativecommons.org/licenses/by/4.0/" }],
    ["licenseLabel", { licenseLabel: "Inna" }],
    ["sourceWidth", { sourceWidth: 100 }],
  ])("updates when %s changed in the file", (_name, change) => {
    expect(decidePhoto(key, stored(change), wanted)).toBe("update");
  });
});
