import { describe, expect, it } from "vitest";

import { formatSavedDate } from "@/features/want-to-see/domain/saved-date";

const NOW = new Date("2026-11-22T10:00:00Z");

describe("formatSavedDate", () => {
  it("writes the day for a list as DD.MM, without the year of this year", () => {
    expect(formatSavedDate(new Date("2026-11-08T10:00:00Z"), NOW)).toBe("08.11");
  });

  it("adds the year when it differs from the current one", () => {
    expect(formatSavedDate(new Date("2025-11-08T10:00:00Z"), NOW)).toBe("08.11.2025");
  });

  it("uses Polish time, so a late evening in UTC is already the next day", () => {
    expect(formatSavedDate(new Date("2026-11-18T23:30:00Z"), NOW)).toBe("19.11");
  });

  it("rejects an invalid date", () => {
    expect(() => formatSavedDate(new Date("not a date"), NOW)).toThrow(RangeError);
  });
});
