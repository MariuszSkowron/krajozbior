import { describe, expect, it } from "vitest";

import {
  NEW_COLLECTIONS_DAYS,
  firstSentence,
  newCollectionsSince,
  placeOfDayIndex,
} from "@/features/catalog/domain/place-of-day";

describe("placeOfDayIndex", () => {
  it("gives nothing without candidates", () => {
    expect(placeOfDayIndex("2026-11-24", 0)).toBeNull();
    expect(placeOfDayIndex("2026-11-24", -3)).toBeNull();
  });

  it("is the same for the same day and the same number of candidates", () => {
    expect(placeOfDayIndex("2026-11-24", 17)).toBe(placeOfDayIndex("2026-11-24", 17));
  });

  it("stays inside 0..count-1 and varies from day to day", () => {
    const days = Array.from(
      { length: 60 },
      (_, i) => `2026-12-${String((i % 28) + 1).padStart(2, "0")}-${i}`,
    );
    const indexes = days.map((day) => placeOfDayIndex(day, 7) as number);

    expect(indexes.every((index) => index >= 0 && index < 7)).toBe(true);
    expect(new Set(indexes).size).toBeGreaterThan(3);
    expect(placeOfDayIndex("2026-11-24", 1)).toBe(0);
  });
});

describe("newCollectionsSince", () => {
  it("is 30 days before now", () => {
    const now = new Date("2026-11-24T10:00:00Z");

    expect(NEW_COLLECTIONS_DAYS).toBe(30);
    expect(newCollectionsSince(now).toISOString()).toBe("2026-10-25T10:00:00.000Z");
  });
});

describe("firstSentence", () => {
  it("takes the text up to the first full stop, question or exclamation mark", () => {
    expect(firstSentence("Zamek nad Wisłą. Drugie zdanie.")).toBe("Zamek nad Wisłą.");
    expect(firstSentence("Czy warto?  Tak.")).toBe("Czy warto?");
    expect(firstSentence("Warto!")).toBe("Warto!");
  });

  it("keeps a text without a full stop and collapses white space", () => {
    expect(firstSentence("  Zamek\n nad   Wisłą ")).toBe("Zamek nad Wisłą");
    expect(firstSentence("Wersja 2.0 zamku")).toBe("Wersja 2.0 zamku");
  });

  it("cuts a long sentence at a word boundary with an ellipsis", () => {
    expect(firstSentence("Alfa beta gamma delta epsilon", 12)).toBe("Alfa beta…");
  });

  it("cuts a long word without spaces at the limit", () => {
    expect(firstSentence("Abcdefghijklmnop", 5)).toBe("Abcde…");
  });
});
