import { describe, expect, it } from "vitest";
import {
  startOfWarsawDay,
  toWarsawWallTime,
  warsawMidnightOf,
  warsawWallTimeToInstant,
} from "@/features/events/domain/polish-time";

const wall = (year: number, month: number, day: number, hour: number, minute = 0) => ({
  year,
  month,
  day,
  hour,
  minute,
});

describe("warsawWallTimeToInstant", () => {
  it("converts winter time (UTC+1) and summer time (UTC+2)", () => {
    expect(warsawWallTimeToInstant(wall(2027, 1, 15, 12, 30))).toEqual({
      ok: true,
      instant: new Date("2027-01-15T11:30:00Z"),
      ambiguous: false,
    });
    expect(warsawWallTimeToInstant(wall(2027, 7, 15, 12, 30))).toEqual({
      ok: true,
      instant: new Date("2027-07-15T10:30:00Z"),
      ambiguous: false,
    });
  });

  it("rejects the hour that does not exist in March (02:00-02:59 on 28 March 2027)", () => {
    expect(warsawWallTimeToInstant(wall(2027, 3, 28, 2, 30))).toEqual({
      ok: false,
      reason: "nonexistent",
    });
    expect(warsawWallTimeToInstant(wall(2027, 3, 28, 2, 0)).ok).toBe(false);
    expect(warsawWallTimeToInstant(wall(2027, 3, 28, 1, 59))).toMatchObject({
      ok: true,
      instant: new Date("2027-03-28T00:59:00Z"),
    });
    expect(warsawWallTimeToInstant(wall(2027, 3, 28, 3, 0))).toMatchObject({
      ok: true,
      instant: new Date("2027-03-28T01:00:00Z"),
    });
  });

  it("takes the first occurrence of the doubled hour in October and marks it (31 October 2027)", () => {
    expect(warsawWallTimeToInstant(wall(2027, 10, 31, 2, 30))).toEqual({
      ok: true,
      instant: new Date("2027-10-31T00:30:00Z"),
      ambiguous: true,
    });
    expect(warsawWallTimeToInstant(wall(2027, 10, 31, 1, 59))).toMatchObject({ ambiguous: false });
    expect(warsawWallTimeToInstant(wall(2027, 10, 31, 3, 0))).toMatchObject({
      ok: true,
      instant: new Date("2027-10-31T02:00:00Z"),
      ambiguous: false,
    });
  });

  it("rejects impossible fields", () => {
    for (const bad of [
      wall(2027, 2, 30, 10),
      wall(2027, 13, 1, 10),
      wall(2027, 1, 1, 24),
      wall(2027, 1, 1, 10, 60),
      wall(2027, 1, 1, -1),
      wall(2027, 1, 1.5, 10),
      wall(1900, 1, 1, 10),
    ]) {
      expect(warsawWallTimeToInstant(bad)).toEqual({ ok: false, reason: "invalid" });
    }
  });
});

describe("toWarsawWallTime", () => {
  it("reads the Warsaw wall clock at an instant, also at midnight", () => {
    expect(toWarsawWallTime(new Date("2027-12-31T23:30:00Z"))).toEqual({
      year: 2028,
      month: 1,
      day: 1,
      hour: 0,
      minute: 30,
      second: 0,
    });
  });
});

describe("startOfWarsawDay", () => {
  it("returns Polish midnight, in winter and in summer", () => {
    expect(startOfWarsawDay(new Date("2027-01-15T22:59:59Z"))).toEqual(
      new Date("2027-01-14T23:00:00Z"),
    );
    expect(startOfWarsawDay(new Date("2027-01-15T23:00:00Z"))).toEqual(
      new Date("2027-01-15T23:00:00Z"),
    );
    expect(startOfWarsawDay(new Date("2027-07-15T21:59:59Z"))).toEqual(
      new Date("2027-07-14T22:00:00Z"),
    );
    expect(startOfWarsawDay(new Date("2027-07-15T22:00:00Z"))).toEqual(
      new Date("2027-07-15T22:00:00Z"),
    );
  });

  it("handles days with a clock change (23 and 25 hours long)", () => {
    expect(startOfWarsawDay(new Date("2027-03-28T10:00:00Z"))).toEqual(
      new Date("2027-03-27T23:00:00Z"),
    );
    expect(startOfWarsawDay(new Date("2027-10-31T10:00:00Z"))).toEqual(
      new Date("2027-10-30T22:00:00Z"),
    );
    expect(warsawMidnightOf(2027, 11, 1)).toEqual(new Date("2027-10-31T23:00:00Z"));
  });
});
