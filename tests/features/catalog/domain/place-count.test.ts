import { describe, expect, it } from "vitest";

import { formatPlaceCount } from "@/features/catalog/domain/place-count";

describe("formatPlaceCount", () => {
  it.each([
    [0, "0 miejsc"],
    [1, "1 miejsce"],
    [2, "2 miejsca"],
    [4, "4 miejsca"],
    [5, "5 miejsc"],
    [12, "12 miejsc"],
    [14, "14 miejsc"],
    [22, "22 miejsca"],
    [24, "24 miejsca"],
    [100, "100 miejsc"],
    [111, "111 miejsc"],
    [112, "112 miejsc"],
  ])("writes %i as %s", (count, text) => {
    expect(formatPlaceCount(count)).toBe(text);
  });
});
