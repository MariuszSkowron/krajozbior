import { describe, expect, it } from "vitest";

import { computeProgress, formatProgress, progressCounts } from "@/features/album/domain/progress";

describe("computeProgress", () => {
  it("counts the visited places of the collection over all its places", () => {
    expect(computeProgress(["a", "b", "c"], ["a", "c"])).toEqual({
      kind: "progress",
      visited: 2,
      total: 3,
    });
  });

  it("is 0 of N when nothing is visited", () => {
    expect(computeProgress(["a", "b"], [])).toEqual({ kind: "progress", visited: 0, total: 2 });
  });

  it("counts a place listed twice once", () => {
    expect(computeProgress(["a", "a", "b"], ["a", "a"])).toEqual({
      kind: "progress",
      visited: 1,
      total: 2,
    });
  });

  it("ignores visited places that are not in the collection any more (1/3 -> 0/2)", () => {
    expect(computeProgress(["a", "b", "c"], ["a"])).toEqual({
      kind: "progress",
      visited: 1,
      total: 3,
    });
    expect(computeProgress(["b", "c"], ["a"])).toEqual({
      kind: "progress",
      visited: 0,
      total: 2,
    });
  });

  it("is a state of its own for a collection without places", () => {
    expect(computeProgress([], ["a"])).toEqual({ kind: "empty" });
  });

  it("accepts any iterable", () => {
    expect(computeProgress(new Set(["a"]), new Set(["a"]))).toEqual({
      kind: "progress",
      visited: 1,
      total: 1,
    });
  });
});

describe("progressCounts and formatProgress", () => {
  it("gives the numbers of the bar and the text", () => {
    const progress = computeProgress(["a", "b", "c"], ["b"]);

    expect(progressCounts(progress)).toEqual({ visited: 1, total: 3 });
    expect(formatProgress(progress)).toBe("1/3");
  });

  it("reads 0/0 for the empty state", () => {
    expect(progressCounts({ kind: "empty" })).toEqual({ visited: 0, total: 0 });
    expect(formatProgress({ kind: "empty" })).toBe("0/0");
  });
});
