import { describe, expect, it } from "vitest";

import { haversineKm } from "@/features/catalog/domain/nearby";
import { formatKm, kmInTransit, warsawDay, type StatsVisit } from "@/features/profile/domain/stats";

const onSite = (visitedAt: string | Date, latitude: number, longitude: number): StatsVisit => ({
  kind: "on_site",
  visitedAt,
  latitude,
  longitude,
});

// One degree of longitude on the equator, a number anybody can check by hand.
const DEGREE_KM = haversineKm(0, 0, 0, 1);

describe("warsawDay", () => {
  it("gives the calendar day in Poland, not in UTC", () => {
    expect(warsawDay("2026-07-10T22:30:00Z")).toBe("2026-07-11"); // 00:30 in summer time
    expect(warsawDay("2026-01-10T22:30:00Z")).toBe("2026-01-10"); // 23:30 in winter time
    expect(warsawDay(new Date("2026-01-10T23:30:00Z"))).toBe("2026-01-11");
  });

  it("gives null for an invalid time", () => {
    expect(warsawDay("not a time")).toBeNull();
  });
});

describe("kmInTransit", () => {
  it("is zero for no visits", () => {
    expect(kmInTransit([])).toBe(0);
  });

  it("is zero for a single visit", () => {
    expect(kmInTransit([onSite("2026-07-10T10:00:00Z", 0, 0)])).toBe(0);
  });

  it("adds the straight-line legs between consecutive visits of one day", () => {
    const km = kmInTransit([
      onSite("2026-07-10T08:00:00Z", 0, 0),
      onSite("2026-07-10T09:00:00Z", 0, 1),
      onSite("2026-07-10T10:00:00Z", 0, 3),
    ]);

    expect(km).toBeCloseTo(3 * DEGREE_KM, 9);
  });

  it("orders the visits of a day by time, whatever the order given", () => {
    const km = kmInTransit([
      onSite("2026-07-10T10:00:00Z", 0, 3),
      onSite("2026-07-10T08:00:00Z", 0, 0),
      onSite("2026-07-10T09:00:00Z", 0, 1),
    ]);

    expect(km).toBeCloseTo(3 * DEGREE_KM, 9);
  });

  it("counts nothing between two days", () => {
    const km = kmInTransit([
      onSite("2026-07-10T10:00:00Z", 0, 0),
      onSite("2026-07-10T11:00:00Z", 0, 1),
      onSite("2026-07-11T10:00:00Z", 50, 50),
      onSite("2026-07-11T11:00:00Z", 50, 51),
    ]);

    expect(km).toBeCloseTo(DEGREE_KM + haversineKm(50, 50, 50, 51), 9);
  });

  it("splits the day at midnight in Warsaw, not at midnight UTC", () => {
    // 23:30 and 00:30 in Warsaw (summer time) are the 10th and the 11th: two days, no leg.
    const split = kmInTransit([
      onSite("2026-07-10T21:30:00Z", 0, 0),
      onSite("2026-07-10T22:30:00Z", 0, 1),
    ]);
    // 00:10 and 01:10 in Warsaw are both the 11th although UTC says the 10th and the 10th: one day, one leg.
    const together = kmInTransit([
      onSite("2026-07-10T22:10:00Z", 0, 0),
      onSite("2026-07-10T23:10:00Z", 0, 1),
    ]);

    expect(split).toBe(0);
    expect(together).toBeCloseTo(DEGREE_KM, 9);
  });

  it("keeps one day across the change to winter time (25 hours)", () => {
    // 2026-10-25: the clocks go back. 00:30 (UTC+2) and 23:30 (UTC+1) are the same day.
    const km = kmInTransit([
      onSite("2026-10-24T22:30:00Z", 0, 0),
      onSite("2026-10-25T22:30:00Z", 0, 1),
    ]);

    expect(km).toBeCloseTo(DEGREE_KM, 9);
  });

  it("splits at midnight on the day of the change to summer time (23 hours)", () => {
    // 2026-03-29: the clocks go forward. 23:30 on the 28th and 00:30 on the 29th are two days.
    const km = kmInTransit([
      onSite("2026-03-28T22:30:00Z", 0, 0), // 23:30, UTC+1
      onSite("2026-03-28T23:30:00Z", 0, 1), // 00:30 on the 29th, UTC+1
    ]);
    // 00:30 and 23:30 (UTC+2) on the 29th are one day.
    const oneDay = kmInTransit([
      onSite("2026-03-28T23:30:00Z", 0, 0),
      onSite("2026-03-29T21:30:00Z", 0, 1),
    ]);

    expect(km).toBe(0);
    expect(oneDay).toBeCloseTo(DEGREE_KM, 9);
  });

  it("skips visits from the past: they change nothing", () => {
    const base = [onSite("2026-07-10T08:00:00Z", 0, 0), onSite("2026-07-10T10:00:00Z", 0, 2)];
    const withPast: StatsVisit[] = [
      base[0]!,
      { kind: "past", visitedAt: "2026-07-10T09:00:00Z", latitude: 10, longitude: 10 },
      base[1]!,
    ];

    expect(kmInTransit(withPast)).toBe(kmInTransit(base));
    expect(kmInTransit([{ ...withPast[1]! }])).toBe(0);
  });

  it("skips a visit without a valid time or place", () => {
    const km = kmInTransit([
      onSite("2026-07-10T08:00:00Z", 0, 0),
      onSite("broken", 0, 5),
      onSite("2026-07-10T08:30:00Z", Number.NaN, 5),
      onSite("2026-07-10T08:40:00Z", 95, 5),
      onSite("2026-07-10T08:50:00Z", 5, 181),
      onSite("2026-07-10T09:00:00Z", 0, 1),
    ]);

    expect(km).toBeCloseTo(DEGREE_KM, 9);
  });

  it("does not add distance for repeated visits of the same place", () => {
    expect(
      kmInTransit([onSite("2026-07-10T08:00:00Z", 54, 18), onSite("2026-07-10T09:00:00Z", 54, 18)]),
    ).toBe(0);
  });

  it("accepts a Date as the time of a visit", () => {
    expect(
      kmInTransit([
        onSite(new Date("2026-07-10T08:00:00Z"), 0, 0),
        onSite(new Date("2026-07-10T09:00:00Z"), 0, 1),
      ]),
    ).toBeCloseTo(DEGREE_KM, 9);
  });
});

describe("formatKm", () => {
  it("writes one decimal at most, with a Polish comma", () => {
    expect(formatKm(0)).toBe("0");
    expect(formatKm(12.34)).toBe("12,3");
    expect(formatKm(7)).toBe("7");
  });

  it("writes 0 for a value that is not a positive number", () => {
    expect(formatKm(-3)).toBe("0");
    expect(formatKm(Number.NaN)).toBe("0");
  });
});
