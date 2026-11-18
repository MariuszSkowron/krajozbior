import { describe, expect, it } from "vitest";

import {
  formatPastVisitDate,
  parsePastVisitRequest,
  warsawToday,
} from "@/features/visits/domain/past-visit-request";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
// 2026-11-18 12:00 in Poland.
const NOW = new Date("2026-11-18T11:00:00Z");

const day = (value: unknown) => ({ placeIds: [A], date: { precision: "day", value } });

describe("warsawToday", () => {
  it("counts the day in Poland, not in UTC, around midnight (winter, UTC+1)", () => {
    expect(warsawToday(new Date("2026-11-18T22:59:59Z"))).toBe("2026-11-18");
    expect(warsawToday(new Date("2026-11-18T23:00:00Z"))).toBe("2026-11-19");
  });

  it("counts the day in Poland in summer (UTC+2)", () => {
    expect(warsawToday(new Date("2026-07-01T21:59:59Z"))).toBe("2026-07-01");
    expect(warsawToday(new Date("2026-07-01T22:00:00Z"))).toBe("2026-07-02");
  });
});

describe("parsePastVisitRequest", () => {
  it("accepts a day and stores it as is", () => {
    expect(parsePastVisitRequest(day("2019-03-12"), NOW)).toEqual({
      placeIds: [A],
      precision: "day",
      visitedOn: "2019-03-12",
    });
  });

  it("stores a month as its first day and a year as 1 January", () => {
    expect(
      parsePastVisitRequest({ placeIds: [A], date: { precision: "month", value: "2019-03" } }, NOW)
        ?.visitedOn,
    ).toBe("2019-03-01");
    expect(
      parsePastVisitRequest({ placeIds: [A], date: { precision: "year", value: "2019" } }, NOW)
        ?.visitedOn,
    ).toBe("2019-01-01");
  });

  it("accepts unknown with no value (or a null one) and stores no date", () => {
    for (const date of [{ precision: "unknown" }, { precision: "unknown", value: null }]) {
      expect(parsePastVisitRequest({ placeIds: [A], date }, NOW)).toEqual({
        placeIds: [A],
        precision: "unknown",
        visitedOn: null,
      });
    }
  });

  it("rejects a value for unknown", () => {
    expect(
      parsePastVisitRequest(
        { placeIds: [A], date: { precision: "unknown", value: "2019-03-12" } },
        NOW,
      ),
    ).toBeNull();
  });

  it("merges duplicate and differently-cased ids", () => {
    const body = { placeIds: [A, B, A, B.toUpperCase()], date: { precision: "unknown" } };

    expect(parsePastVisitRequest(body, NOW)?.placeIds).toEqual([A, B]);
  });

  it("accepts 1 and 100 places and rejects 0 and 101", () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const date = { precision: "unknown" };

    expect(parsePastVisitRequest({ placeIds: ids(1), date }, NOW)).not.toBeNull();
    expect(parsePastVisitRequest({ placeIds: ids(100), date }, NOW)?.placeIds).toHaveLength(100);
    expect(parsePastVisitRequest({ placeIds: [], date }, NOW)).toBeNull();
    expect(parsePastVisitRequest({ placeIds: ids(101), date }, NOW)).toBeNull();
    // 101 entries that merge into one are still refused: the input is bounded.
    expect(parsePastVisitRequest({ placeIds: Array(101).fill(A), date }, NOW)).toBeNull();
  });

  it("rejects a body of the wrong shape", () => {
    const date = { precision: "unknown" };

    for (const body of [
      undefined,
      null,
      "x",
      [],
      {},
      { placeIds: A, date },
      { placeIds: [A, "nope"], date },
      { placeIds: [A, 5], date },
      { placeIds: [A] },
      { placeIds: [A], date: null },
      { placeIds: [A], date: [] },
      { placeIds: [A], date: "2019" },
      { placeIds: [A], date: { precision: "week", value: "2019" } },
      { placeIds: [A], date: {} },
    ]) {
      expect(parsePastVisitRequest(body, NOW)).toBeNull();
    }
  });

  it("rejects a value that does not match the precision", () => {
    for (const date of [
      { precision: "day" },
      { precision: "day", value: 20190312 },
      { precision: "day", value: "2019-3-12" },
      { precision: "day", value: "2019-03" },
      { precision: "day", value: "2019-02-31" },
      { precision: "day", value: "2019-13-01" },
      { precision: "month", value: "2019-03-12" },
      { precision: "month", value: "2019-13" },
      { precision: "month", value: "2019-00" },
      { precision: "month", value: "2019" },
      { precision: "year", value: "19" },
      { precision: "year", value: "2019-03" },
    ]) {
      expect(parsePastVisitRequest({ placeIds: [A], date }, NOW)).toBeNull();
    }
  });

  it("accepts a real leap day and rejects a missing one", () => {
    expect(parsePastVisitRequest(day("2020-02-29"), NOW)?.visitedOn).toBe("2020-02-29");
    expect(parsePastVisitRequest(day("2019-02-29"), NOW)).toBeNull();
  });

  it("rejects a date before 1900 and accepts 1 January 1900", () => {
    expect(parsePastVisitRequest(day("1899-12-31"), NOW)).toBeNull();
    expect(parsePastVisitRequest(day("1900-01-01"), NOW)?.visitedOn).toBe("1900-01-01");
    expect(
      parsePastVisitRequest({ placeIds: [A], date: { precision: "year", value: "1899" } }, NOW),
    ).toBeNull();
  });

  it("rejects a future day, a future month and a future year, and accepts today", () => {
    expect(parsePastVisitRequest(day("2026-11-19"), NOW)).toBeNull();
    expect(parsePastVisitRequest(day("2026-11-18"), NOW)?.visitedOn).toBe("2026-11-18");
    expect(
      parsePastVisitRequest({ placeIds: [A], date: { precision: "month", value: "2026-12" } }, NOW),
    ).toBeNull();
    expect(
      parsePastVisitRequest({ placeIds: [A], date: { precision: "month", value: "2026-11" } }, NOW),
    ).not.toBeNull();
    expect(
      parsePastVisitRequest({ placeIds: [A], date: { precision: "year", value: "2027" } }, NOW),
    ).toBeNull();
    expect(
      parsePastVisitRequest({ placeIds: [A], date: { precision: "year", value: "2026" } }, NOW),
    ).not.toBeNull();
  });

  it("takes today in Poland at midnight: 23:30 UTC is already tomorrow there", () => {
    const justBefore = new Date("2026-11-18T22:59:00Z");
    const justAfter = new Date("2026-11-18T23:01:00Z");

    expect(parsePastVisitRequest(day("2026-11-19"), justBefore)).toBeNull();
    expect(parsePastVisitRequest(day("2026-11-19"), justAfter)?.visitedOn).toBe("2026-11-19");
    expect(parsePastVisitRequest(day("2026-11-20"), justAfter)).toBeNull();
  });
});

describe("formatPastVisitDate", () => {
  it("formats by precision", () => {
    expect(formatPastVisitDate("day", "2019-03-12")).toBe("12 marca 2019");
    expect(formatPastVisitDate("day", "2019-12-01")).toBe("1 grudnia 2019");
    expect(formatPastVisitDate("month", "2019-03-01")).toBe("marzec 2019");
    expect(formatPastVisitDate("month", "2019-01-01")).toBe("styczeń 2019");
    expect(formatPastVisitDate("year", "2019-01-01")).toBe("2019");
    expect(formatPastVisitDate("unknown", null)).toBe("data nieznana");
  });

  it("says the date is unknown when no date is stored", () => {
    expect(formatPastVisitDate("day", null)).toBe("data nieznana");
  });
});
