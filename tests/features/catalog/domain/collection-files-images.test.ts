import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseImportFile } from "@/features/catalog/domain/import-file";

// Pliki kolekcji z repozytorium dokumentacji (prywatnego), tylko do odczytu i bez sieci. Bez
// repozytorium obok (CI, osoba z zewnątrz) test się pomija; fikstura 11 par w
// `commons-license.test.ts` sprawdza regułę bez plików.
const candidates = [
  resolve(process.cwd(), "..", "krajozbior-docs", "data", "curation"),
  resolve(process.cwd(), "..", "..", "..", "krajozbior-docs", "data", "curation"),
];
const directory = candidates.find((candidate) => existsSync(candidate));
const files = ["2026-11-19-kolekcje-pilot.ndjson", "2026-11-20-fala-1.ndjson"];

describe.skipIf(directory === undefined)("zdjęcia w plikach kolekcji", () => {
  it("accepts 170 images and skips none (spec 5.11.4, rule A-B1)", () => {
    let accepted = 0;
    let skipped = 0;
    let withBlock = 0;

    for (const name of files) {
      const parsed = parseImportFile(readFileSync(join(directory!, name), "utf8"), {
        profile: "full",
      });

      expect(parsed.ok).toBe(true);

      if (!parsed.ok) {
        continue;
      }

      for (const place of parsed.places) {
        if (place.image !== null) {
          accepted += 1;
        }

        if (place.imageSkipped) {
          skipped += 1;
        }

        withBlock += place.image !== null || place.imageSkipped ? 1 : 0;
      }
    }

    expect({ accepted, skipped, withBlock }).toEqual({ accepted: 170, skipped: 0, withBlock: 170 });
  });
});
