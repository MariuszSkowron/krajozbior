import { describe, expect, it } from "vitest";

import { formatSaveCount } from "@/features/catalog/domain/save-count";

describe("formatSaveCount", () => {
  it("hides zero, one and two saves", () => {
    expect(formatSaveCount(0)).toBe("mniej niż 3");
    expect(formatSaveCount(1)).toBe("mniej niż 3");
    expect(formatSaveCount(2)).toBe("mniej niż 3");
  });

  it("shows the exact number from three", () => {
    expect(formatSaveCount(3)).toBe("3");
    expect(formatSaveCount(120)).toBe("120");
  });
});
