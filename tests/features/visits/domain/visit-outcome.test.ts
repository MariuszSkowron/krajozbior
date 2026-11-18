import { describe, expect, it } from "vitest";

import {
  DATE_PRECISIONS,
  VISIT_KINDS,
  formatDistance,
  geolocationProblemMessage,
  toVisitOutcome,
  visitOutcomeMessage,
} from "@/features/visits/domain/visit-outcome";

describe("formatDistance", () => {
  it("writes metres below a kilometre", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(201)).toBe("201 m");
    expect(formatDistance(350)).toBe("350 m");
    expect(formatDistance(999)).toBe("999 m");
    expect(formatDistance(999.6)).toBe("1 km");
  });

  it("writes kilometres with one decimal and a comma", () => {
    expect(formatDistance(1234)).toBe("1,2 km");
    expect(formatDistance(6200)).toBe("6,2 km");
    expect(formatDistance(12_340)).toBe("12,3 km");
  });

  it("drops a zero decimal", () => {
    expect(formatDistance(1000)).toBe("1 km");
    expect(formatDistance(2040)).toBe("2 km");
  });

  it("refuses a value that is not a distance", () => {
    expect(() => formatDistance(-1)).toThrow(RangeError);
    expect(() => formatDistance(Number.NaN)).toThrow(RangeError);
    expect(() => formatDistance(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("toVisitOutcome", () => {
  it("maps every result of the database function", () => {
    expect(toVisitOutcome({ result: "recorded", distance_m: 12 }, 30)).toEqual({
      result: "recorded",
      distanceM: 12,
    });
    expect(toVisitOutcome({ result: "out_of_range", distance_m: 6200 }, 30)).toEqual({
      result: "out_of_range",
      distanceM: 6200,
    });
    expect(toVisitOutcome({ result: "inaccurate", distance_m: null }, 151.6)).toEqual({
      result: "inaccurate",
      accuracyM: 152,
    });
    expect(toVisitOutcome({ result: "not_found", distance_m: null }, 30)).toEqual({
      result: "not_found",
    });
  });

  it("refuses an answer without a distance and an unknown result", () => {
    expect(() => toVisitOutcome({ result: "recorded", distance_m: null }, 1)).toThrow(/distance/);
    expect(() => toVisitOutcome({ result: "out_of_range", distance_m: null }, 1)).toThrow(
      /distance/,
    );
    expect(() => toVisitOutcome({ result: "maybe", distance_m: 1 }, 1)).toThrow(/unknown/);
  });
});

describe("visitOutcomeMessage", () => {
  it("says what happened in Polish", () => {
    expect(visitOutcomeMessage({ result: "recorded", distanceM: 10 })).toBe("Wizyta potwierdzona.");
    expect(visitOutcomeMessage({ result: "out_of_range", distanceM: 6200 })).toBe(
      "Jesteś 6,2 km od miejsca.",
    );
    expect(visitOutcomeMessage({ result: "inaccurate", accuracyM: 180 })).toBe(
      "Lokalizacja jest zbyt niedokładna (±180 m). Spróbuj na zewnątrz.",
    );
    expect(visitOutcomeMessage({ result: "not_found" })).toBe("Nie znaleziono tego miejsca.");
  });
});

describe("geolocationProblemMessage", () => {
  it("has a text for every problem, each telling what to do", () => {
    const problems = ["denied", "unavailable", "unsupported", "timeout"] as const;
    const messages = problems.map(geolocationProblemMessage);

    expect(new Set(messages).size).toBe(4);
    expect(messages.every((message) => message.length > 10)).toBe(true);
    expect(geolocationProblemMessage("denied")).toContain("zgody");
  });
});

describe("frozen lists", () => {
  it("lists the kinds and precisions the migration copies", () => {
    expect([...VISIT_KINDS]).toEqual(["on_site", "past"]);
    expect([...DATE_PRECISIONS]).toEqual(["day", "month", "year", "unknown"]);
  });
});
