import { describe, expect, it } from "vitest";

import {
  composeAttribution,
  descriptionMethodOf,
  wikidataQidOf,
  wikidataUrl,
} from "@/features/catalog/domain/place-sources";

const sources = new Map([
  ["zrodlo_a", { label: "Źródło testowe A", license: "CC BY 4.0" }],
  ["zrodlo_b", { label: "Źródło testowe B", license: "CC0 1.0" }],
]);

describe("composeAttribution", () => {
  it("joins the sources in the order of the keys as 'label (licence)'", () => {
    expect(composeAttribution(["zrodlo_a", "zrodlo_b"], sources)).toBe(
      "Źródło testowe A (CC BY 4.0); Źródło testowe B (CC0 1.0)",
    );
    expect(composeAttribution(["zrodlo_b", "zrodlo_a"], sources)).toBe(
      "Źródło testowe B (CC0 1.0); Źródło testowe A (CC BY 4.0)",
    );
  });

  it("gives null for no key and skips a key the batch does not list", () => {
    expect(composeAttribution([], sources)).toBeNull();
    expect(composeAttribution(["nieznane"], sources)).toBeNull();
    expect(composeAttribution(["nieznane", "zrodlo_a"], sources)).toBe(
      "Źródło testowe A (CC BY 4.0)",
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
