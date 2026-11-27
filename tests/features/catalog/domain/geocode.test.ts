import { describe, expect, it } from "vitest";

import {
  GEOCODE_MAX_RESULTS,
  GEOCODE_QUERY_MAX_LENGTH,
  normalizeGeocodeQuery,
  parseGeocodeResponse,
} from "@/features/catalog/domain/geocode";

describe("normalizeGeocodeQuery", () => {
  it("trims and folds white space", () => {
    expect(normalizeGeocodeQuery("  ul.  Dworcowa 1,\n Rumia ")).toBe("ul. Dworcowa 1, Rumia");
  });

  it("refuses a value that is not a text of a sensible size", () => {
    expect(normalizeGeocodeQuery(42)).toBeNull();
    expect(normalizeGeocodeQuery(undefined)).toBeNull();
    expect(normalizeGeocodeQuery("  ab ")).toBeNull();
    expect(normalizeGeocodeQuery("x".repeat(GEOCODE_QUERY_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeGeocodeQuery("x".repeat(GEOCODE_QUERY_MAX_LENGTH))).not.toBeNull();
  });
});

describe("parseGeocodeResponse", () => {
  it("keeps places with a position in range and rounds it", () => {
    expect(
      parseGeocodeResponse([
        { lat: "54.09280049", lon: "18.7919", display_name: " Rumia, Pomorskie " },
      ]),
    ).toEqual([{ label: "Rumia, Pomorskie", latitude: 54.0928, longitude: 18.7919 }]);
  });

  it("drops everything that is not a place with a valid position", () => {
    expect(
      parseGeocodeResponse([
        null,
        "text",
        { lat: "x", lon: "18", display_name: "Bez liczby" },
        { lat: "91", lon: "18", display_name: "Za wysoko" },
        { lat: "54", lon: "181", display_name: "Za daleko" },
        { lat: "54", lon: "18", display_name: "  " },
        { lat: "54", lon: "18" },
      ]),
    ).toEqual([]);
  });

  it("gives an empty list for an answer that is not a list", () => {
    expect(parseGeocodeResponse({ error: "x" })).toEqual([]);
    expect(parseGeocodeResponse(null)).toEqual([]);
  });

  it("returns at most the allowed number of results and cuts a long label", () => {
    const many = Array.from({ length: GEOCODE_MAX_RESULTS + 3 }, (_, index) => ({
      lat: "54",
      lon: String(18 + index / 100),
      display_name: "n".repeat(500),
    }));
    const results = parseGeocodeResponse(many);

    expect(results).toHaveLength(GEOCODE_MAX_RESULTS);
    expect(results[0].label).toHaveLength(300);
  });
});
