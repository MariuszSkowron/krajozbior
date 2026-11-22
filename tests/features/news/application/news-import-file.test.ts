import { describe, expect, it } from "vitest";

import {
  MAX_NEWS_IMPORT_FILE_BYTES,
  parseNewsImportFile,
} from "@/features/news/application/news-import-file";
import { chooseNewsSlug, newsSlugBase } from "@/features/news/application/news-slug";

const ID_1 = "3f6b1f4e-7a40-4d3b-9c55-0a1e2b3c4d51";
const ID_2 = "3f6b1f4e-7a40-4d3b-9c55-0a1e2b3c4d52";

const line = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: ID_1,
    kind: "guide",
    title: "Krajozbiór startuje",
    lead: "Krótki opis.",
    body: "Treść.\n\nDrugi akapit.",
    collection_slug: null,
    place_id: null,
    event_starts_on: null,
    event_ends_on: null,
    status: "published",
    ...overrides,
  });

const errorsOf = (content: string) => {
  const result = parseNewsImportFile(content);

  expect(result.ok).toBe(false);

  return result.ok ? [] : result.errors;
};

describe("parseNewsImportFile", () => {
  it("accepts a valid file with Polish letters and CRLF, skipping blank lines", () => {
    const content = `${line({ title: "Zażółć gęślą jaźń" })}\r\n\r\n${line({ id: ID_2, kind: "event", event_starts_on: "2026-12-01", status: "draft" })}\r\n`;
    const result = parseNewsImportFile(content);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]).toMatchObject({ line: 1, id: ID_1, status: "published" });
      expect(result.entries[0]!.input.title).toBe("Zażółć gęślą jaźń");
      expect(result.entries[1]).toMatchObject({ line: 3, status: "draft" });
      expect(result.entries[1]!.input.eventStartsOn).toBe("2026-12-01");
    }
  });

  it("names the line of every bad line, without text of the file", () => {
    const errors = errorsOf(
      [
        line(),
        "{nie json",
        line({ id: ID_2, title: "ab" }),
        line({ id: "zly", status: "hidden" }),
        "[1]",
      ].join("\n"),
    );

    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 4, 5]);
    expect(errors.find((e) => e.line === 2)!.message).toBe("Linia nie jest poprawnym JSON.");
    expect(errors.find((e) => e.field === "title")!.message).toContain("od 5 do 120");
    expect(errors.find((e) => e.field === "status")).toBeDefined();
    expect(errors.find((e) => e.line === 5)!.message).toBe("Linia ma być obiektem JSON.");
  });

  it("refuses six links, a shortener and a missing event date (strict validation)", () => {
    const links = Array.from({ length: 6 }, (_, i) => `https://przyklad.pl/${i}`).join(" ");

    expect(errorsOf(line({ body: links }))[0]).toMatchObject({ field: "body", line: 1 });
    expect(errorsOf(line({ body: "https://bit.ly/abc" }))[0]).toMatchObject({ field: "body" });
    expect(errorsOf(line({ kind: "event" }))[0]).toMatchObject({ field: "eventStartsOn" });
    expect(errorsOf(line({ kind: "zly" }))[0]).toMatchObject({ field: "kind" });
  });

  it("refuses a field that is not on the form instead of dropping it", () => {
    const errors = errorsOf(line({ tytul: "literówka", "ó<b>": 1 }));

    expect(errors).toHaveLength(2);
    expect(errors[0]!.message).toContain("Nieznane pole");
    expect(errors[1]!.message).not.toContain("<");
  });

  it("refuses collection_slug with a value (the command reads no catalog) but not null", () => {
    expect(errorsOf(line({ collection_slug: "latarnie" }))[0]).toMatchObject({
      field: "collection_slug",
    });
    expect(parseNewsImportFile(line({ collection_slug: undefined })).ok).toBe(true);
  });

  it("takes collection_id and place_id as identifiers", () => {
    const result = parseNewsImportFile(line({ collection_id: ID_2, place_id: ID_2 }));

    expect(result.ok && result.entries[0]!.input.collectionId).toBe(ID_2);
    expect(errorsOf(line({ place_id: "nie-uuid" }))[0]).toMatchObject({ field: "placeId" });
  });

  it("refuses a repeated id, an empty file and a file that is too large", () => {
    expect(errorsOf(`${line()}\n${line()}`)[0]).toMatchObject({ line: 2, field: "id" });
    expect(errorsOf("\n  \n")[0]).toMatchObject({ line: 0, field: "file" });
    expect(errorsOf(" ".repeat(MAX_NEWS_IMPORT_FILE_BYTES + 1))[0]!.message).toContain("2 MiB");
  });

  it("refuses more items than an organization may hold", () => {
    const uuid = (n: number) => `3f6b1f4e-7a40-4d3b-9c55-${String(n).padStart(12, "0")}`;
    const content = Array.from({ length: 201 }, (_, n) => line({ id: uuid(n) })).join("\n");

    expect(errorsOf(content)[0]!.message).toContain("200");
  });
});

describe("news address", () => {
  it("is made of the title without Polish marks", () => {
    expect(newsSlugBase("Zażółć gęślą jaźń!")).toBe("zazolc-gesla-jazn");
    expect(newsSlugBase("Łódź — „Pierwsze” kolekcje")).toBe("lodz-pierwsze-kolekcje");
    expect(newsSlugBase("!!!")).toBe("aktualnosc");
    expect(newsSlugBase("a".repeat(100))).toHaveLength(80);
  });

  it("takes the first free address and keeps the limit", () => {
    expect(chooseNewsSlug("Tytuł wpisu", new Set())).toBe("tytul-wpisu");
    expect(chooseNewsSlug("Tytuł wpisu", new Set(["tytul-wpisu", "tytul-wpisu-2"]))).toBe(
      "tytul-wpisu-3",
    );

    const long = "a".repeat(80);

    expect(chooseNewsSlug(long, new Set([long]))).toBe(`${"a".repeat(78)}-2`);
  });
});
