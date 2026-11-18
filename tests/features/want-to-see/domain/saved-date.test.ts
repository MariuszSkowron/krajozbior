import { describe, expect, it } from "vitest";

import { formatSavedDate } from "@/features/want-to-see/domain/saved-date";

describe("formatSavedDate", () => {
  it("writes the day in Polish with the month name", () => {
    expect(formatSavedDate(new Date("2026-11-18T10:00:00Z"))).toBe("18 listopada 2026");
  });

  it("uses Polish time, so a late evening in UTC is already the next day", () => {
    expect(formatSavedDate(new Date("2026-11-18T23:30:00Z"))).toBe("19 listopada 2026");
  });

  it("rejects an invalid date", () => {
    expect(() => formatSavedDate(new Date("not a date"))).toThrow(RangeError);
  });
});
