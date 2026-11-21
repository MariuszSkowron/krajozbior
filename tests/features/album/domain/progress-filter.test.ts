import { describe, expect, it } from "vitest";

import {
  PROGRESS_FILTERS,
  PROGRESS_FILTER_LABELS,
  matchesProgressFilter,
  parseProgressFilter,
} from "@/features/album/domain/progress-filter";
import type { Progress } from "@/features/album/domain/progress";

const progress = (visited: number, total: number): Progress => ({
  kind: "progress",
  visited,
  total,
});
const EMPTY: Progress = { kind: "empty" };

describe("parseProgressFilter", () => {
  it("reads the known values of ?stan=", () => {
    for (const value of PROGRESS_FILTERS) {
      expect(parseProgressFilter(value)).toBe(value);
    }
  });

  it("falls back to everything for a missing, unknown or repeated value", () => {
    expect(parseProgressFilter(undefined)).toBe("wszystkie");
    expect(parseProgressFilter("cokolwiek")).toBe("wszystkie");
    expect(parseProgressFilter(["ukonczone", "w-trakcie"])).toBe("wszystkie");
  });

  it("has a Polish label for every filter", () => {
    expect(PROGRESS_FILTER_LABELS).toEqual({
      wszystkie: "Wszystkie",
      "w-trakcie": "W trakcie",
      nierozpoczete: "Nierozpoczęte",
      ukonczone: "Ukończone",
    });
  });
});

describe("matchesProgressFilter", () => {
  it.each([
    // [progress, wszystkie, w-trakcie, nierozpoczete, ukonczone]
    ["0 of 5", progress(0, 5), true, false, true, false],
    ["1 of 5", progress(1, 5), true, true, false, false],
    ["4 of 5", progress(4, 5), true, true, false, false],
    ["5 of 5", progress(5, 5), true, false, false, true],
    ["1 of 1", progress(1, 1), true, false, false, true],
    ["empty collection", EMPTY, true, false, true, false],
  ] as const)("%s", (_name, value, all, inProgress, notStarted, finished) => {
    expect(matchesProgressFilter(value, "wszystkie")).toBe(all);
    expect(matchesProgressFilter(value, "w-trakcie")).toBe(inProgress);
    expect(matchesProgressFilter(value, "nierozpoczete")).toBe(notStarted);
    expect(matchesProgressFilter(value, "ukonczone")).toBe(finished);
  });
});
