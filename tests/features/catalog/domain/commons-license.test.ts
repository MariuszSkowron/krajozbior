import { describe, expect, it } from "vitest";

import {
  COMMONS_LICENSE_CODES,
  normalizeCommonsLicense,
  parseLicenseShort,
  parseLicenseUrl,
} from "@/features/catalog/domain/commons-license";

const cc = "https://creativecommons.org";

// Jedenaście par `license_short` / adres z dzisiejszych plików kolekcji (spec 5.11.4) i wynik.
const PAIRS: readonly [string, string, string, string, string][] = [
  ["CC BY 2.5", `${cc}/licenses/by/2.5`, "cc-by-2.5", "CC BY 2.5", `${cc}/licenses/by/2.5/`],
  ["CC BY 3.0", `${cc}/licenses/by/3.0`, "cc-by-3.0", "CC BY 3.0", `${cc}/licenses/by/3.0/`],
  ["CC BY 4.0", `${cc}/licenses/by/4.0`, "cc-by-4.0", "CC BY 4.0", `${cc}/licenses/by/4.0/`],
  [
    "CC BY-SA 2.0",
    `${cc}/licenses/by-sa/2.0`,
    "cc-by-sa-2.0",
    "CC BY-SA 2.0",
    `${cc}/licenses/by-sa/2.0/`,
  ],
  [
    "CC BY-SA 2.5",
    `${cc}/licenses/by-sa/2.5`,
    "cc-by-sa-2.5",
    "CC BY-SA 2.5",
    `${cc}/licenses/by-sa/2.5/`,
  ],
  [
    "CC BY-SA 3.0",
    `${cc}/licenses/by-sa/3.0`,
    "cc-by-sa-3.0",
    "CC BY-SA 3.0",
    `${cc}/licenses/by-sa/3.0/`,
  ],
  [
    "CC BY-SA 3.0",
    `${cc}/licenses/by-sa/3.0/`,
    "cc-by-sa-3.0",
    "CC BY-SA 3.0",
    `${cc}/licenses/by-sa/3.0/`,
  ],
  [
    "CC BY-SA 3.0 pl",
    `${cc}/licenses/by-sa/3.0/pl/deed.en`,
    "cc-by-sa-3.0",
    "CC BY-SA 3.0 PL",
    `${cc}/licenses/by-sa/3.0/pl/`,
  ],
  [
    "CC BY-SA 4.0",
    `${cc}/licenses/by-sa/4.0`,
    "cc-by-sa-4.0",
    "CC BY-SA 4.0",
    `${cc}/licenses/by-sa/4.0/`,
  ],
  ["CC0", `${cc}/publicdomain/zero/1.0/`, "cc0-1.0", "CC0 1.0", `${cc}/publicdomain/zero/1.0/`],
  [
    "Public domain",
    `${cc}/publicdomain/mark/1.0/`,
    "public-domain",
    "domena publiczna",
    `${cc}/publicdomain/mark/1.0/`,
  ],
];

describe("normalizeCommonsLicense", () => {
  it.each(PAIRS)("%s + %s → %s", (short, url, code, label, canonical) => {
    expect(normalizeCommonsLicense(short, url)).toEqual({
      ok: true,
      license: { code, label, url: canonical },
    });
  });

  it("accepts every code of the frozen list (the migration CHECK uses the same one)", () => {
    const accepted = new Set(PAIRS.map((pair) => pair[2]));

    expect([...accepted].every((code) => COMMONS_LICENSE_CODES.includes(code as never))).toBe(true);
  });

  it("refuses a pair whose address contradicts the code (CC BY with a by-sa address)", () => {
    expect(normalizeCommonsLicense("CC BY 4.0", `${cc}/licenses/by-sa/4.0`)).toEqual({ ok: false });
    expect(normalizeCommonsLicense("CC BY 4.0", `${cc}/licenses/by/3.0`)).toEqual({ ok: false });
  });

  it("handles the extra cases of the rule", () => {
    const sa3pl = `${cc}/licenses/by-sa/3.0/pl/`;

    for (const [short, url, label, canonical] of [
      ["CC BY-SA 3.0 PL", sa3pl, "CC BY-SA 3.0 PL", sa3pl],
      ["CC BY 4.0", `${cc}/licenses/by/4.0/deed.pl`, "CC BY 4.0", `${cc}/licenses/by/4.0/`],
      ["CC BY 4.0", `${cc}/licenses/by/4.0/legalcode`, "CC BY 4.0", `${cc}/licenses/by/4.0/`],
      ["CC BY 4.0", `${cc}/licenses/by/4.0/legalcode.pl`, "CC BY 4.0", `${cc}/licenses/by/4.0/`],
      [
        "  cc   by-sa  4.0 ",
        `  http://creativecommons.org/licenses/by-sa/4.0/?x=1#y `,
        "CC BY-SA 4.0",
        `${cc}/licenses/by-sa/4.0/`,
      ],
    ] as const) {
      expect(normalizeCommonsLicense(short, url)).toEqual({
        ok: true,
        license: expect.objectContaining({ label, url: canonical }),
      });
    }
  });

  it("refuses a foreign host, a country with 4.0 and unknown licences", () => {
    expect(normalizeCommonsLicense("CC BY 4.0", "https://example.com/licenses/by/4.0/")).toEqual({
      ok: false,
    });
    expect(normalizeCommonsLicense("CC BY 4.0 PL", `${cc}/licenses/by/4.0/pl/`)).toEqual({
      ok: false,
    });
    expect(normalizeCommonsLicense("CC BY-NC 4.0", `${cc}/licenses/by-nc/4.0/`)).toEqual({
      ok: false,
    });
    expect(normalizeCommonsLicense("CC BY 1.0", `${cc}/licenses/by/1.0/`)).toEqual({ ok: false });
    expect(normalizeCommonsLicense("GFDL", `${cc}/licenses/by/4.0/`)).toEqual({ ok: false });
    expect(normalizeCommonsLicense("CC BY 4.0", "not a url")).toEqual({ ok: false });
  });

  it("requires the country in both places or in none (verification 2 of the review)", () => {
    // Kraj tylko w adresie.
    expect(normalizeCommonsLicense("CC BY-SA 3.0", `${cc}/licenses/by-sa/3.0/pl/`)).toEqual({
      ok: false,
    });
    // Kraj tylko w `license_short`.
    expect(normalizeCommonsLicense("CC BY-SA 3.0 PL", `${cc}/licenses/by-sa/3.0/`)).toEqual({
      ok: false,
    });
    // Dwa różne kraje.
    expect(normalizeCommonsLicense("CC BY-SA 3.0 DE", `${cc}/licenses/by-sa/3.0/pl/`)).toEqual({
      ok: false,
    });
  });

  it("allows an empty address only for the public domain mark", () => {
    expect(normalizeCommonsLicense("Public domain", "")).toEqual({
      ok: true,
      license: expect.objectContaining({ url: `${cc}/publicdomain/mark/1.0/` }),
    });
    expect(normalizeCommonsLicense("Public domain", null)).toMatchObject({ ok: true });
    expect(normalizeCommonsLicense("Public domain", undefined)).toMatchObject({ ok: true });
    expect(normalizeCommonsLicense("CC BY 4.0", "")).toEqual({ ok: false });
    expect(normalizeCommonsLicense("CC0", `${cc}/publicdomain/mark/1.0/`)).toEqual({ ok: false });
  });
});

describe("parseLicenseUrl and parseLicenseShort", () => {
  it("rejects what is not an address of Creative Commons", () => {
    expect(parseLicenseUrl("")).toBeNull();
    expect(parseLicenseUrl("ftp://creativecommons.org/licenses/by/4.0/")).toBeNull();
    expect(parseLicenseUrl("https://user:pw@creativecommons.org/licenses/by/4.0/")).toBeNull();
    expect(parseLicenseUrl("https://creativecommons.org.evil.test/licenses/by/4.0/")).toBeNull();
    expect(parseLicenseUrl(`${cc}/licenses/by/4.0/extra/path`)).toBeNull();
  });

  it("reads family, version and country", () => {
    expect(parseLicenseUrl(`${cc}/licenses/by-sa/2.5/pl/deed.en`)).toEqual({
      family: "by-sa",
      version: "2.5",
      country: "pl",
    });
    expect(parseLicenseUrl(`${cc}/publicdomain/zero/1.0`)).toEqual({
      family: "zero",
      version: "1.0",
      country: null,
    });
  });

  it("normalizes the short name", () => {
    expect(parseLicenseShort(" cc0 ")).toEqual({ family: "zero", version: "1.0", country: null });
    expect(parseLicenseShort("CC0 1.0")).toMatchObject({ family: "zero" });
    expect(parseLicenseShort("public  DOMAIN")).toMatchObject({ family: "mark" });
    expect(parseLicenseShort("CC BY 3.0 pl")).toEqual({
      family: "by",
      version: "3.0",
      country: "pl",
    });
    expect(parseLicenseShort("Something else")).toBeNull();
  });
});
