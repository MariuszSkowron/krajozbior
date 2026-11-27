import { describe, expect, it } from "vitest";

import { formatSaveCount } from "@/features/catalog/domain/save-count";

describe("formatSaveCount", () => {
  it("shows zero exactly", () => {
    expect(formatSaveCount(0)).toBe("0");
  });

  it("hides one and two saves", () => {
    expect(formatSaveCount(1)).toBe("mniej niż 3");
    expect(formatSaveCount(2)).toBe("mniej niż 3");
  });

  it("shows the exact number from three", () => {
    expect(formatSaveCount(3)).toBe("3");
    expect(formatSaveCount(120)).toBe("120");
  });
});
