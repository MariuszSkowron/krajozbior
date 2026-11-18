import { describe, expect, it } from "vitest";

import { completedOn, isComplete, type FirstVisit } from "@/features/album/domain/completion";

const day = (on: string): FirstVisit => ({ on, precision: "day" });
const year = (on: string): FirstVisit => ({ on, precision: "year" });
const unknown: FirstVisit = { on: null, precision: "unknown" };

describe("isComplete", () => {
  it("is complete when every place is visited", () => {
    expect(isComplete({ kind: "progress", visited: 3, total: 3 })).toBe(true);
  });

  it("is not complete while a place is missing", () => {
    expect(isComplete({ kind: "progress", visited: 2, total: 3 })).toBe(false);
  });

  it("is never complete for 0/0", () => {
    expect(isComplete({ kind: "empty" })).toBe(false);
  });
});

describe("completedOn", () => {
  it("is the latest of the dates, rounded to a month", () => {
    expect(completedOn([day("2026-03-10"), day("2026-05-02"), day("2026-04-30")])).toEqual({
      precision: "month",
      year: 2026,
      month: 5,
    });
  });

  it("treats a month precision visit like a dated one", () => {
    expect(completedOn([{ on: "2025-07-01", precision: "month" }, day("2025-02-14")])).toEqual({
      precision: "month",
      year: 2025,
      month: 7,
    });
  });

  it("gives the bare year when a year-only visit is not older than the dated ones", () => {
    expect(completedOn([day("2025-03-10"), year("2025-01-01")])).toEqual({
      precision: "year",
      year: 2025,
    });
    expect(completedOn([year("2021-01-01"), year("2023-01-01")])).toEqual({
      precision: "year",
      year: 2023,
    });
  });

  it("keeps the month when the dated visit is in a later year than the year-only one", () => {
    expect(completedOn([day("2026-03-10"), year("2025-01-01")])).toEqual({
      precision: "month",
      year: 2026,
      month: 3,
    });
  });

  it("ignores undated visits, and has no date when all are undated or none exist", () => {
    expect(completedOn([unknown, day("2024-06-06")])).toEqual({
      precision: "month",
      year: 2024,
      month: 6,
    });
    expect(completedOn([unknown, unknown])).toBeNull();
    expect(completedOn([])).toBeNull();
  });

  it("skips a dated visit with a malformed or missing date", () => {
    expect(completedOn([{ on: "soon", precision: "day" }])).toBeNull();
    expect(completedOn([{ on: null, precision: "day" }])).toBeNull();
  });
});
