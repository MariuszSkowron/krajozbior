import { describe, expect, it } from "vitest";

import {
  ANONYMOUS_NAME,
  avatarLetter,
  formatDisplayName,
} from "@/features/profile/domain/display-name";

describe("formatDisplayName", () => {
  it('makes "Anna K." from the first name and the initial (Q3)', () => {
    expect(formatDisplayName("Anna", "K")).toBe("Anna K.");
    expect(formatDisplayName("Żaneta", "Ł")).toBe("Żaneta Ł.");
  });

  it("shows the first name alone without an initial", () => {
    expect(formatDisplayName("Anna", null)).toBe("Anna");
  });

  it("says Odkrywca without a name", () => {
    expect(ANONYMOUS_NAME).toBe("Odkrywca");
    expect(formatDisplayName(null, null)).toBe("Odkrywca");
  });
});

describe("avatarLetter", () => {
  it("is the first letter of the name in uppercase", () => {
    expect(avatarLetter("anna")).toBe("A");
    expect(avatarLetter("Łukasz")).toBe("Ł");
  });

  it("is the first letter of Odkrywca without a name", () => {
    expect(avatarLetter(null)).toBe("O");
  });
});
