import { describe, expect, it } from "vitest";

import {
  composeAttribution,
  descriptionMethodOf,
  wikidataQidOf,
  wikidataUrl,
} from "@/features/catalog/domain/place-sources";

const sources = new Map([
  ["nid", { label: "Narodowy Instytut Dziedzictwa", license: "CC BY 4.0" }],
  ["wikidata", { label: "Wikidane", license: "CC0 1.0" }],
]);

describe("composeAttribution", () => {
  it("joins the sources in the order of the keys as 'label (licence)'", () => {
    expect(composeAttribution(["nid", "wikidata"], sources)).toBe(
      "Narodowy Instytut Dziedzictwa (CC BY 4.0); Wikidane (CC0 1.0)",
    );
    expect(composeAttribution(["wikidata", "nid"], sources)).toBe(
      "Wikidane (CC0 1.0); Narodowy Instytut Dziedzictwa (CC BY 4.0)",
    );
  });

  it("gives null for no key and skips a key the batch does not list", () => {
    expect(composeAttribution([], sources)).toBeNull();
    expect(composeAttribution(["nieznane"], sources)).toBeNull();
    expect(composeAttribution(["nieznane", "nid"], sources)).toBe(
      "Narodowy Instytut Dziedzictwa (CC BY 4.0)",
    );
  });
});

describe("descriptionMethodOf", () => {
  it("maps the wording of the file to the one of the database", () => {
    expect(descriptionMethodOf("template")).toBe("facts_template");
    expect(descriptionMethodOf("curator")).toBe("curator");
  });
});

describe("wikidataQidOf and wikidataUrl", () => {
  it("takes the element from a Wikidata key only", () => {
    expect(wikidataQidOf("wd:Q2969507")).toBe("Q2969507");
    expect(wikidataQidOf("ext:TEST-0001")).toBeNull();
    expect(wikidataQidOf("wd:Q12x")).toBeNull();
    expect(wikidataQidOf("col:wd:Q1")).toBeNull();
  });

  it("builds the address of the element", () => {
    expect(wikidataUrl("Q42")).toBe("https://www.wikidata.org/wiki/Q42");
  });
});
