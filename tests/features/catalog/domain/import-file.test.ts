import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  COLLECTION_KEY_PREFIX,
  IMPORT_KEY_PATTERN,
  composeAccessInfo,
  parseImportFile,
} from "@/features/catalog/domain/import-file";
import type { ImportFileError, ImportProfile } from "@/features/catalog/domain/import-file";

// Loose on purpose: the tests edit parsed fixture records field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "tests/fixtures/curation", name), "utf8");

const fullFile = fixture("minimal.ndjson");
const publicFile = fixture("minimal-public.ndjson");

function records(content: string): Rec[] {
  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Rec);
}

const serialize = (items: Rec[]) => items.map((item) => JSON.stringify(item)).join("\n") + "\n";

/** Edits the records of the full fixture (0 = batch, 1-2 = collections, 3-5 = places). */
function edited(change: (items: Rec[]) => void, base = fullFile): string {
  const items = records(base);

  change(items);

  return serialize(items);
}

function errorsOf(content: string, profile?: ImportProfile): readonly ImportFileError[] {
  const result = parseImportFile(content, { profile });

  if (result.ok) {
    throw new Error("expected the file to be refused");
  }

  return result.errors;
}

const has = (errors: readonly ImportFileError[], line: number | null, path: string, code: string) =>
  errors.some((error) => error.line === line && error.path === path && error.code === code);

describe("access restriction of a place (E1-S11)", () => {
  const withRestriction = (value: unknown) =>
    edited((items) => {
      items[4]!.access = { ...items[4]!.access, restriction: value };
    });

  it("defaults to none when the record has no field", () => {
    const result = parseImportFile(fullFile);

    expect(result.ok && result.places.map((item) => item.input.accessRestriction)).toEqual([
      "none",
      "none",
      "none",
    ]);
  });

  it.each(["none", "private", "fenced", "ruin"])("accepts %s in both profiles", (value) => {
    for (const profile of ["full", "public"] as const) {
      const base = profile === "full" ? fullFile : publicFile;
      const content = edited((items) => {
        items[4]!.access = { ...items[4]!.access, restriction: value };
      }, base);
      const result = parseImportFile(content, { profile });

      expect(result.ok && result.places[1]?.input.accessRestriction).toBe(value);
    }
  });

  it("refuses an unknown value with the path of the field and no text from the file", () => {
    const errors = errorsOf(withRestriction("zamkniete"));

    expect(errors.some((error) => error.line === 5 && error.path.startsWith("access"))).toBe(true);
    expect(JSON.stringify(errors)).not.toContain("zamkniete");
  });
});

describe("the fixtures", () => {
  it("full fixture passes and is normalized for the loader", () => {
    const result = parseImportFile(fullFile);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.batch.batchId).toBe("test-batch-1");
    expect(result.batch.sources.map((source) => source.key)).toEqual(["zrodlo_a", "zrodlo_b"]);
    expect(result.batch.sources[0]).toMatchObject({ url: null, dataDate: null });
    expect(result.batch.sources[1]).toMatchObject({
      url: "https://example.org/zrodlo-b",
      dataDate: "2026-01-01",
    });
    expect(result.collections.map((item) => [item.importKey, item.publish, item.region])).toEqual([
      ["col:testowa-jeden", true, "pomorskie"],
      ["col:testowa-dwa", false, "mazowieckie"],
    ]);
    expect(result.places.map((item) => item.reviewStatus)).toEqual([
      "approved",
      "approved",
      "approved_in_collection",
    ]);
    expect(result.places[1]?.input.accessInfo).toBe(
      "Wejście od ulicy testowej.\n\nUwaga: fikcyjny punkt, nie istnieje.",
    );
    expect(result.places[0]).toMatchObject({
      wikipediaUrl: "https://pl.wikipedia.org/wiki/Miejsce_testowe_pierwsze",
      powiat: "Powiat testowy",
      descriptionMethod: "template",
    });
    expect(result.places[2]).toMatchObject({ powiat: null, wikipediaUrl: null, locality: null });
    expect(result.externalKeys).toEqual([]);
  });

  it("public fixture passes the public profile and the default profile", () => {
    expect(parseImportFile(publicFile, { profile: "public" }).ok).toBe(true);
    expect(parseImportFile(publicFile).ok).toBe(true);
  });

  it("full fixture is refused by the public profile, field by field", () => {
    const errors = errorsOf(fullFile, "public");

    expect(has(errors, 4, "", "unknown_field")).toBe(true);
    expect(has(errors, 4, "review", "unknown_field")).toBe(true);
    expect(errors.every((error) => error.line !== null)).toBe(true);
  });

  it("the public fixture is the full fixture without the full-only fields", () => {
    const stripped = edited((items) => {
      for (const item of items.slice(3)) {
        delete item.image;
        delete item.source_refs;
        delete item.notes;
        delete item.review.flags;
      }
    });

    expect(records(stripped)).toEqual(records(publicFile).map((item) => item));
  });
});

describe("lines and records", () => {
  it("accepts a byte order mark, CRLF line ends and blank lines", () => {
    const content = "﻿" + fullFile.replace(/\n/g, "\r\n\r\n");

    expect(parseImportFile(content).ok).toBe(true);
  });

  it("refuses invalid JSON and non-object lines with the line number", () => {
    const content = [JSON.stringify(records(fullFile)[0]), "{oops", "[1]", "null", "7"].join("\n");
    const errors = errorsOf(content);

    expect(has(errors, 2, "", "invalid_json")).toBe(true);
    expect(has(errors, 3, "", "not_an_object")).toBe(true);
    expect(has(errors, 4, "", "not_an_object")).toBe(true);
    expect(has(errors, 5, "", "not_an_object")).toBe(true);
  });

  it("refuses a NUL character and a less-than sign anywhere in a record", () => {
    const withNul = edited((items) => {
      items[3]!.name = "a\u0000b";
    });
    const withTag = edited((items) => {
      items[1]!.summary = "<b>x</b>";
    });
    const inList = edited((items) => {
      items[3]!.description.sources = ["zrodlo_a", "<"];
    });
    const inKey = edited((items) => {
      items[3]!.notes = { a: ["ok", "x<y"] };
    });

    expect(has(errorsOf(withNul), 4, "", "forbidden_character")).toBe(true);
    expect(has(errorsOf(withTag), 2, "", "forbidden_character")).toBe(true);
    expect(has(errorsOf(inList), 4, "", "forbidden_character")).toBe(true);
    expect(has(errorsOf(inKey), 4, "", "forbidden_character")).toBe(true);
  });

  it.each([
    ["DEL", "\u007f"],
    ["C1 control (start)", "\u0080"],
    ["C1 control (end)", "\u009f"],
    ["bidi embedding start", "‪"],
    ["bidi override end", "‮"],
    ["bidi isolate start", "⁦"],
    ["bidi isolate end", "⁩"],
  ])("refuses %s in titles and texts", (_label, character) => {
    const inName = edited((items) => {
      items[3]!.name = `a${character}b`;
    });
    const inSummary = edited((items) => {
      items[1]!.summary = `a${character}b`;
    });
    const inKey = edited((items) => {
      items[3]!.notes = { [`k${character}`]: ["ok"] };
    });

    expect(has(errorsOf(inName), 4, "", "forbidden_character")).toBe(true);
    expect(has(errorsOf(inSummary), 2, "", "forbidden_character")).toBe(true);
    expect(has(errorsOf(inKey), 4, "", "forbidden_character")).toBe(true);
  });

  it("refuses an unknown record type", () => {
    const content = edited((items) => {
      items.push({ type: "other" });
    });

    expect(has(errorsOf(content), 7, "type", "unknown_type")).toBe(true);
  });
});

describe("order of records", () => {
  it("refuses an empty file: no batch and no collection", () => {
    const errors = errorsOf("");

    expect(has(errors, null, "", "missing_batch")).toBe(true);
    expect(has(errors, null, "", "no_collection")).toBe(true);
  });

  it("refuses a file without a batch, and does not check sources then", () => {
    const content = edited((items) => {
      items.shift();
    });
    const errors = errorsOf(content);

    expect(has(errors, 1, "type", "batch_not_first")).toBe(true);
    expect(has(errors, null, "", "missing_batch")).toBe(true);
    expect(errors.some((error) => error.code === "unknown_source")).toBe(false);
  });

  it("refuses a batch that comes after a collection or after a place", () => {
    const afterCollection = edited((items) => {
      items.splice(0, 1);
      items.splice(1, 0, records(fullFile)[0]!);
    });
    const afterPlace = edited(
      (items) => {
        const [batch] = items.splice(0, 1);

        items.splice(2, 0, batch!);
      },
      edited((items) => items.splice(1, 2)),
    );
    const errors = errorsOf(afterCollection);

    expect(has(errors, 1, "type", "batch_not_first")).toBe(true);
    expect(has(errors, 2, "type", "batch_not_first")).toBe(true);
    expect(errors.some((error) => error.code === "unknown_source")).toBe(false);
    expect(has(errorsOf(afterPlace), 3, "type", "batch_not_first")).toBe(true);
  });

  it("refuses a second batch", () => {
    const content = edited((items) => {
      items.splice(1, 0, items[0]!);
    });

    expect(has(errorsOf(content), 2, "type", "duplicate_batch")).toBe(true);
  });

  it("refuses a collection that comes after a place", () => {
    const content = edited((items) => {
      items.push(items[1]!);
    });

    expect(has(errorsOf(content), 7, "type", "collection_after_place")).toBe(true);
  });
});

describe("batch record", () => {
  it("refuses a wrong schema, an unknown field and a missing batch id", () => {
    const content = edited((items) => {
      items[0]!.schema = "other/1";
      items[0]!.extra = "x";
      delete items[0]!.batch_id;
    });
    const errors = errorsOf(content);

    expect(has(errors, 1, "schema", "bad_value")).toBe(true);
    expect(has(errors, 1, "", "unknown_field")).toBe(true);
    expect(has(errors, 1, "batch_id", "required")).toBe(true);
  });

  it("refuses bad dates, no sources, a duplicate source key and bad source links", () => {
    const content = edited((items) => {
      items[0]!.created_at = "yesterday";
      items[0]!.sources[1].data_date = "2026-13-40";
      items[0]!.sources[0].license_url = "https://creativecommons.example/x";
      items[0]!.sources[0].url = "http://example.org/";
    });
    const errors = errorsOf(content);

    expect(has(errors, 1, "created_at", "bad_format")).toBe(true);
    expect(has(errors, 1, "sources[1].data_date", "bad_format")).toBe(true);
    expect(has(errors, 1, "sources[0].license_url", "bad_url")).toBe(true);
    expect(has(errors, 1, "sources[0].url", "bad_url")).toBe(true);
    expect(
      has(errorsOf(edited((items) => (items[0]!.sources = []))), 1, "sources", "length_or_range"),
    ).toBe(true);
  });
});

describe("batch sources", () => {
  it("refuses a repeated source key", () => {
    const content = edited((items) => {
      items[0]!.sources[1].key = "zrodlo_a";
    });

    expect(has(errorsOf(content), 1, "sources[1].key", "duplicate_source")).toBe(true);
  });
});

describe("collection record", () => {
  it("refuses a review state other than approved, in any form", () => {
    for (const status of ["approved_in_collection", "draft", ""]) {
      const content = edited((items) => {
        items[1]!.review.status = status;
      });

      expect(has(errorsOf(content), 2, "review.status", "bad_value")).toBe(true);
    }
  });

  it("refuses publish values other than true and false", () => {
    const content = edited((items) => {
      items[1]!.publish = "yes";
    });

    expect(has(errorsOf(content), 2, "publish", "wrong_type")).toBe(true);
  });

  it("applies the domain limits to title, summary and region", () => {
    const content = edited((items) => {
      items[1]!.title = "  ";
      items[1]!.summary = "s".repeat(281);
      items[1]!.region = "polska";
    });
    const errors = errorsOf(content);

    expect(has(errors, 2, "title", "bad_value")).toBe(true);
    expect(has(errors, 2, "summary", "bad_value")).toBe(true);
    expect(has(errors, 2, "region", "bad_value")).toBe(true);
  });

  describe("extra voivodeships (extra_regions)", () => {
    const region = (): string => records(fullFile)[1]!.region as string;
    const other = (...skip: string[]) =>
      ["opolskie", "slaskie", "lubuskie", "lodzkie", "podlaskie"].filter(
        (code) => code !== region() && !skip.includes(code),
      );
    const withExtra = (value: unknown) =>
      edited((items) => {
        items[1]!.extra_regions = value;
      });
    const extraOf = (content: string) => {
      const result = parseImportFile(content);

      return result.ok ? result.collections[0]!.extraRegions : "refused";
    };

    it("means 'no change' when the field is absent, and an empty list when it is []", () => {
      expect(extraOf(fullFile)).toBeNull();
      expect(extraOf(withExtra([]))).toEqual([]);
    });

    it("returns the list in the order of REGIONS", () => {
      const [first, second] = other();

      expect(extraOf(withExtra([second, first]))).toEqual(
        ["opolskie", "slaskie", "lubuskie", "lodzkie", "podlaskie"].filter(
          (code) => code === first || code === second,
        ),
      );
    });

    it("reports an unknown code at the path of the element", () => {
      const errors = errorsOf(withExtra([other()[0], "atlantyda"]));

      expect(has(errors, 2, "extra_regions[1]", "bad_value")).toBe(true);
    });

    it("refuses a repeat, the main voivodeship and more than three", () => {
      const [first, second, third, fourth] = other();

      expect(has(errorsOf(withExtra([first, first])), 2, "extra_regions", "duplicate")).toBe(true);
      expect(has(errorsOf(withExtra([region()])), 2, "extra_regions", "same_as_region")).toBe(true);
      expect(
        has(errorsOf(withExtra([first, second, third, fourth])), 2, "extra_regions", "too_many"),
      ).toBe(true);
    });

    it("refuses a value that is not a list", () => {
      expect(has(errorsOf(withExtra("opolskie")), 2, "extra_regions", "wrong_type")).toBe(true);
    });

    it("keeps the error free of the text of the file", () => {
      const errors = errorsOf(withExtra(["SEKRET-12345"]));

      expect(JSON.stringify(errors)).not.toContain("SEKRET");
    });
  });

  describe("kind of the collection (kind)", () => {
    const withKind = (value: unknown) =>
      edited((items) => {
        items[1]!.kind = value;
      });
    const kindOf = (content: string) => {
      const result = parseImportFile(content);

      return result.ok ? result.collections[0]!.kind : "refused";
    };

    it("means 'no change' when the field is absent (characterization of a file without it)", () => {
      const result = parseImportFile(fullFile);

      expect(result.ok).toBe(true);
      expect(kindOf(fullFile)).toBeNull();
    });

    it("accepts land and theme", () => {
      expect(kindOf(withKind("land"))).toBe("land");
      expect(kindOf(withKind("theme"))).toBe("theme");
    });

    it("refuses another code or another type, without the text of the file", () => {
      expect(has(errorsOf(withKind("SEKRET-12345")), 2, "kind", "bad_value")).toBe(true);
      expect(JSON.stringify(errorsOf(withKind("SEKRET-12345")))).not.toContain("SEKRET");
      expect(has(errorsOf(withKind(3)), 2, "kind", "wrong_type")).toBe(true);
    });
  });

  it("refuses an empty list of places, a key of the wrong shape and a key without the prefix", () => {
    const empty = edited((items) => {
      items[1]!.places = [];
    });
    const shape = edited((items) => {
      items[1]!.places = ["ext:TEST-0001", "bad key"];
    });
    const prefix = edited((items) => {
      items[1]!.import_key = "ext:TEST-0099";
    });

    expect(has(errorsOf(empty), 2, "places", "length_or_range")).toBe(true);
    expect(has(errorsOf(shape), 2, "places[1]", "bad_format")).toBe(true);
    expect(has(errorsOf(prefix), 2, "import_key", "bad_collection_key")).toBe(true);
  });

  it("refuses more than 200 places", () => {
    const content = edited((items) => {
      items[1]!.places = Array.from({ length: 201 }, (_, index) => `ext:T${index}`);
    });

    expect(has(errorsOf(content), 2, "places", "length_or_range")).toBe(true);
  });

  it("accepts a collection with keys that have no place record and lists them", () => {
    const content = edited((items) => {
      items[2]!.places = ["ext:TEST-0003", "ext:ZZ-2", "ext:AA-1"];
      items[1]!.places = ["ext:TEST-0001", "ext:TEST-0002", "ext:ZZ-2"];
    });
    const result = parseImportFile(content);

    expect(result.ok && result.externalKeys).toEqual(["ext:AA-1", "ext:ZZ-2"]);
  });

  it("accepts a file that has collections only", () => {
    const content = edited((items) => {
      items.splice(3);
      items[1]!.places = ["ext:A-1"];
      items[2]!.places = ["ext:A-1"];
    });
    const result = parseImportFile(content);

    expect(result.ok && [result.places.length, result.externalKeys]).toEqual([0, ["ext:A-1"]]);
  });
});

describe("keys", () => {
  it("keeps the general key pattern in one constant", () => {
    expect(COLLECTION_KEY_PREFIX).toBe("col:");

    for (const good of ["ext:TEST-0001", "col:a", "abcdefgh:A_b-9"]) {
      expect(IMPORT_KEY_PATTERN.test(good)).toBe(true);
    }

    for (const bad of [
      "x",
      ":a",
      "Ext:a",
      "abcdefghi:a",
      "ext:",
      "ext:-a",
      `ext:${"a".repeat(65)}`,
    ]) {
      expect(IMPORT_KEY_PATTERN.test(bad)).toBe(false);
    }
  });

  it("refuses duplicate keys per kind and the same place twice in a collection", () => {
    const content = edited((items) => {
      items[2]!.import_key = items[1]!.import_key;
      items[4]!.import_key = items[3]!.import_key;
      items[1]!.places = ["ext:TEST-0001", "ext:TEST-0001", "ext:TEST-0002"];
    });
    const errors = errorsOf(content);

    expect(has(errors, 3, "import_key", "duplicate_key")).toBe(true);
    expect(has(errors, 5, "import_key", "duplicate_key")).toBe(true);
    expect(has(errors, 2, "places", "duplicate_place")).toBe(true);
  });

  it("allows a place key to equal a key of the other kind only by prefix, not by value", () => {
    const content = edited((items) => {
      items[3]!.import_key = "col:zle";
    });

    expect(has(errorsOf(content), 4, "import_key", "bad_place_key")).toBe(true);
  });

  it("refuses a place record that no collection lists", () => {
    const content = edited((items) => {
      items[4]!.import_key = "ext:TEST-0050";
    });
    const errors = errorsOf(content);

    expect(has(errors, 5, "import_key", "unreferenced_place")).toBe(true);
  });
});

describe("place record", () => {
  it("refuses a missing field, a wrong type and an unknown field without naming the field", () => {
    const content = edited((items) => {
      delete items[3]!.address;
      items[3]!.name = 7;
      items[3]!.surprise_field = 1;
    });
    const errors = errorsOf(content);

    expect(has(errors, 4, "address", "required")).toBe(true);
    expect(has(errors, 4, "name", "wrong_type")).toBe(true);
    expect(has(errors, 4, "", "unknown_field")).toBe(true);
    expect(JSON.stringify(errors)).not.toContain("surprise_field");
  });

  it("applies the domain limits to name, description, address and visit radius", () => {
    const content = edited((items) => {
      items[3]!.name = "n".repeat(121);
      items[3]!.description.text = "d".repeat(4001);
      items[3]!.address = "a".repeat(201);
      items[3]!.location.visit_radius_m = 10;
    });
    const errors = errorsOf(content);

    expect(has(errors, 4, "name", "bad_value")).toBe(true);
    expect(has(errors, 4, "description.text", "bad_value")).toBe(true);
    expect(has(errors, 4, "address", "bad_value")).toBe(true);
    expect(has(errors, 4, "location.visit_radius_m", "bad_value")).toBe(true);
  });

  it("limits the composed access text, not only its parts", () => {
    const content = edited((items) => {
      items[3]!.access = { note: "n".repeat(600), warning: "w".repeat(600) };
    });

    expect(has(errorsOf(content), 4, "access", "bad_value")).toBe(true);
  });

  it("keeps a place inside the rectangle around Poland", () => {
    const outside = edited((items) => {
      items[3]!.location.lat = 48.9;
      items[3]!.location.lon = 24.3;
      items[4]!.location.lat = 54.91;
      items[4]!.location.lon = 14.0;
      items[5]!.location.lat = 49.0;
      items[5]!.location.lon = 24.2;
    });
    const nonsense = edited((items) => {
      items[3]!.location.lat = 91;
      items[3]!.location.lon = 181;
    });
    const errors = errorsOf(outside);

    expect(has(errors, 4, "location.lat", "outside_poland")).toBe(true);
    expect(has(errors, 4, "location.lon", "outside_poland")).toBe(true);
    expect(has(errors, 5, "location.lat", "outside_poland")).toBe(true);
    expect(has(errors, 5, "location.lon", "outside_poland")).toBe(true);
    expect(errors.some((error) => error.line === 6)).toBe(false);
    expect(has(errorsOf(nonsense), 4, "location.lat", "bad_value")).toBe(true);
    expect(has(errorsOf(nonsense), 4, "location.lon", "bad_value")).toBe(true);
  });

  it("takes only the sixteen region codes in admin.region", () => {
    const polska = edited((items) => {
      items[3]!.admin.region = "polska";
    });
    const accents = edited((items) => {
      items[3]!.admin.region = "łódzkie";
    });

    expect(has(errorsOf(polska), 4, "admin.region", "bad_value")).toBe(true);
    expect(has(errorsOf(accents), 4, "admin.region", "bad_value")).toBe(true);
  });

  it("takes only two description methods", () => {
    const content = edited((items) => {
      items[3]!.description.method = "other";
    });

    expect(has(errorsOf(content), 4, "description.method", "bad_value")).toBe(true);
  });

  it("applies the review rules: states and flags", () => {
    const state = edited((items) => {
      items[3]!.review.status = "pending";
    });
    const flagged = edited((items) => {
      items[5]!.review = { status: "approved_in_collection", flags: ["x"] };
    });
    const emptyFlags = edited((items) => {
      items[5]!.review = { status: "approved_in_collection", flags: [] };
    });
    const tooMany = edited((items) => {
      items[3]!.review.flags = Array.from({ length: 21 }, () => "x");
    });

    expect(has(errorsOf(state), 4, "review.status", "bad_value")).toBe(true);
    expect(has(errorsOf(flagged), 6, "review.status", "flags_need_approved")).toBe(true);
    expect(parseImportFile(emptyFlags).ok).toBe(true);
    expect(has(errorsOf(tooMany), 4, "review.flags", "length_or_range")).toBe(true);
  });

  it("checks the links of a place against the allowed hosts and https", () => {
    const bad = (change: (place: Rec) => void) => errorsOf(edited((items) => change(items[3]!)));

    expect(
      has(
        bad((p) => (p.wikipedia_pl = "http://pl.wikipedia.org/wiki/X")),
        4,
        "wikipedia_pl",
        "bad_url",
      ),
    ).toBe(true);
    expect(
      has(
        bad((p) => (p.wikipedia_pl = "https://example.org/wiki/X")),
        4,
        "wikipedia_pl",
        "bad_url",
      ),
    ).toBe(true);
    expect(
      has(
        bad((p) => (p.wikipedia_pl = "https://user:pw@pl.wikipedia.org/x")),
        4,
        "wikipedia_pl",
        "bad_url",
      ),
    ).toBe(true);
    expect(
      has(
        bad((p) => (p.wikipedia_pl = "https://pl.wikipedia.org/w/index.php?title=X")),
        4,
        "wikipedia_pl",
        "bad_url",
      ),
    ).toBe(true);
    expect(
      has(
        bad((p) => (p.wikipedia_pl = "not a url")),
        4,
        "wikipedia_pl",
        "bad_url",
      ),
    ).toBe(true);
    expect(
      has(
        bad((p) => (p.image.file_url = "https://example.org/a.jpg")),
        4,
        "image.file_url",
        "bad_url",
      ),
    ).toBe(true);
    expect(
      has(
        bad((p) => (p.image.page_url = "https://example.org/a")),
        4,
        "image.page_url",
        "bad_url",
      ),
    ).toBe(true);
    expect(
      has(
        bad((p) => (p.image.license_url = "https://example.org/l")),
        4,
        "image.license_url",
        "bad_url",
      ),
    ).toBe(true);
    expect(
      has(
        bad((p) => (p.image.author_url = "http://example.org/")),
        4,
        "image.author_url",
        "bad_url",
      ),
    ).toBe(true);
  });

  it("accepts an image author link and an empty optional link", () => {
    const content = edited((items) => {
      items[3]!.image.author_url = "https://example.org/autor";
      items[3]!.wikipedia_pl = null;
      items[3]!.image = null;
    });

    expect(parseImportFile(content).ok).toBe(true);
  });

  it("checks the image block shape", () => {
    const content = edited((items) => {
      items[3]!.image.mime = "image/gif";
      items[3]!.image.width = 0;
    });
    const errors = errorsOf(content);

    expect(has(errors, 4, "image.mime", "bad_value")).toBe(true);
    expect(has(errors, 4, "image.width", "length_or_range")).toBe(true);
  });
});

describe("the image block of a place (E4-2a)", () => {
  it("is accepted by the public profile too and reaches the loader normalized", () => {
    const withImage = edited((items) => {
      const place = items[3]!;

      place.image = JSON.parse(
        fullFile.split("\n").find((line) => line.includes('"image"'))!,
      ).image;
      place.image.license_short = "CC BY-SA 3.0 pl";
      place.image.license_url = "https://creativecommons.org/licenses/by-sa/3.0/pl/deed.en";
      place.image.width = 3660;
      delete place.review.flags;
      delete place.source_refs;
      delete place.notes;
    }, publicFile);

    const result = parseImportFile(withImage, { profile: "public" });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.places[0]).toMatchObject({
      imageSkipped: false,
      image: {
        commonsFile: "Miejsce testowe pierwsze.jpg",
        sourceWidth: 3660,
        authorUrl: null,
        license: {
          code: "cc-by-sa-3.0",
          label: "CC BY-SA 3.0 PL",
          url: "https://creativecommons.org/licenses/by-sa/3.0/pl/",
        },
      },
    });
    expect(result.places[1]).toMatchObject({ image: null, imageSkipped: false });
  });

  it("marks a licence outside the list as skipped without refusing the file", () => {
    const content = edited((items) => {
      items[3]!.image.license_short = "CC BY-NC 4.0";
      items[3]!.image.license_url = "https://creativecommons.org/licenses/by-nc/4.0";
    });
    const result = parseImportFile(content);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.places[0]).toMatchObject({ image: null, imageSkipped: true });
    }
  });
});

describe("source keys", () => {
  it("refuses keys that are not in the batch: description, attribution and references", () => {
    const content = edited((items) => {
      items[3]!.description.sources = ["zrodlo_a", "nieznane"];
      items[3]!.attribution = ["nieznane"];
      items[3]!.source_refs = [{ source: "nieznane", ref: "TEST-0001" }];
    });
    const errors = errorsOf(content);

    expect(has(errors, 4, "description.sources[1]", "unknown_source")).toBe(true);
    expect(has(errors, 4, "attribution[0]", "unknown_source")).toBe(true);
    expect(has(errors, 4, "source_refs[0].source", "unknown_source")).toBe(true);
  });

  it("refuses a signature that does not fit the 500 characters kept with the place", () => {
    const widen = (items: Rec[]) => {
      items[0]!.sources[0].label = "x".repeat(200);
      items[0]!.sources[1].label = "y".repeat(200);
      items[0]!.sources.push({ ...items[0]!.sources[0], key: "zrodlo_c", label: "z".repeat(200) });
    };
    const long = edited((items) => {
      widen(items);
      items[3]!.attribution = ["zrodlo_a", "zrodlo_b", "zrodlo_c"];
    });
    const fits = edited((items) => {
      widen(items);
      items[3]!.attribution = ["zrodlo_a", "zrodlo_b"];
    });

    expect(has(errorsOf(long), 4, "attribution", "length_or_range")).toBe(true);
    expect(parseImportFile(fits).ok).toBe(true);
  });

  it("refuses a place without a source signature", () => {
    const content = edited((items) => {
      items[3]!.attribution = [];
    });

    expect(has(errorsOf(content), 4, "attribution", "missing_attribution")).toBe(true);
  });

  it("checks the shape of references and their number", () => {
    const content = edited((items) => {
      items[3]!.source_refs = [{ source: "zrodlo_a", ref: " padded " }];
      items[4]!.source_refs = Array.from({ length: 11 }, () => ({ source: "zrodlo_a", ref: "x" }));
      items[5]!.source_refs = [{ source: "zrodlo_a", ref: "" }];
    });
    const errors = errorsOf(content);

    expect(has(errors, 4, "source_refs[0].ref", "bad_ref")).toBe(true);
    expect(has(errors, 5, "source_refs", "length_or_range")).toBe(true);
    expect(has(errors, 6, "source_refs[0].ref", "length_or_range")).toBe(true);
  });

  it("takes any key of the right shape, with no list of known keys", () => {
    const content = edited((items) => {
      items[0]!.sources[0].key = "zrodlo_inne";
      for (const place of items.slice(3)) {
        place.description.sources = ["zrodlo_inne"];
        place.attribution = ["zrodlo_inne"];
        delete place.source_refs;
      }
    });

    expect(parseImportFile(content).ok).toBe(true);
    expect(
      has(
        errorsOf(edited((items) => (items[0]!.sources[0].key = "Bad Key"))),
        1,
        "sources[0].key",
        "bad_format",
      ),
    ).toBe(true);
  });
});

describe("notes", () => {
  it("accepts text and lists of text", () => {
    const content = edited((items) => {
      items[3]!.notes = { a: "x", b: ["y", "z"], key_9: [] };
    });

    expect(parseImportFile(content).ok).toBe(true);
  });

  it("reports every problem as the bare path notes, without keys or values", () => {
    const secret = "secret_marker";
    const cases: Array<[Rec, string]> = [
      [{ [`Bad-${secret}`]: "x" }, "^(invalid|bad_format|length_or_range)$"],
      [{ a: 5 }, "^(invalid|wrong_type)$"],
      [{ a: "v".repeat(201) }, "^(invalid|length_or_range)$"],
      [{ a: Array.from({ length: 21 }, () => "v") }, "^(invalid|length_or_range)$"],
      [
        Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`k${index}`, "x"])),
        "too_many",
      ],
      [[`${secret}`] as unknown as Rec, "wrong_type"],
    ];

    for (const [notes, code] of cases) {
      const content = edited((items) => {
        items[3]!.notes = notes;
      });
      const errors = errorsOf(content);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every((error) => error.path === "notes" && error.line === 4)).toBe(true);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toMatch(new RegExp(code));
      expect(JSON.stringify(errors)).not.toContain(secret);
    }
  });

  it("does not repeat the same error for many bad entries", () => {
    const content = edited((items) => {
      items[3]!.notes = { a: 1, b: 2, c: 3 };
    });

    expect(errorsOf(content).filter((error) => error.path === "notes")).toHaveLength(1);
  });

  it("is refused by the public profile", () => {
    const content = edited((items) => {
      for (const item of items.slice(3)) {
        delete item.image;
        delete item.source_refs;
        delete item.review.flags;
      }
    });

    expect(has(errorsOf(content, "public"), 4, "", "unknown_field")).toBe(true);
    expect(parseImportFile(content, { profile: "full" }).ok).toBe(true);
  });
});

describe("error values", () => {
  it("never carry text from the file", () => {
    const marker = "ZZ_marker_ZZ";
    const content = edited((items) => {
      items[0]!.sources[0].license_url = `http://${marker}.example`;
      items[1]!.title = "";
      items[1]![`extra_${marker}`] = marker;
      items[3]!.wikipedia_pl = `https://${marker}.example`;
      items[3]!.description.sources = [marker];
      items[3]!.import_key = `ext:${marker}`;
    });
    const errors = errorsOf(content);

    expect(errors.length).toBeGreaterThan(3);
    expect(JSON.stringify(errors)).not.toContain(marker);
  });
});

describe("composeAccessInfo", () => {
  it("joins note and warning with an empty line and leaves out empty parts", () => {
    expect(composeAccessInfo("A", "B")).toBe("A\n\nB");
    expect(composeAccessInfo("A", null)).toBe("A");
    expect(composeAccessInfo(undefined, " B ")).toBe("B");
    expect(composeAccessInfo("  ", "")).toBe("");
    expect(composeAccessInfo("a\r\nb", undefined)).toBe("a\nb");
  });
});
