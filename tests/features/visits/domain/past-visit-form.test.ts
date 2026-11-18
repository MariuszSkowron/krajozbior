import { describe, expect, it } from "vitest";

import {
  EMPTY_PAST_VISIT_DATE,
  pastVisitBadgeText,
  pastVisitFailureMessage,
  pastVisitRemovalFailureMessage,
  pastVisitSavedMessage,
  toPastVisitDateBody,
} from "@/features/visits/domain/past-visit-form";

describe("toPastVisitDateBody", () => {
  it("defaults to an unknown date, which needs no field", () => {
    expect(toPastVisitDateBody(EMPTY_PAST_VISIT_DATE)).toEqual({ precision: "unknown" });
  });

  it("reads only the field of the chosen precision", () => {
    const form = { ...EMPTY_PAST_VISIT_DATE, day: "2019-03-12", month: "05", monthYear: "2018" };

    expect(toPastVisitDateBody({ ...form, precision: "day" })).toEqual({
      precision: "day",
      value: "2019-03-12",
    });
    expect(toPastVisitDateBody({ ...form, precision: "month" })).toEqual({
      precision: "month",
      value: "2018-05",
    });
    expect(toPastVisitDateBody({ ...form, year: "2017", precision: "year" })).toEqual({
      precision: "year",
      value: "2017",
    });
    expect(toPastVisitDateBody({ ...form, precision: "unknown" })).toEqual({
      precision: "unknown",
    });
  });

  it("returns null when the chosen field is empty or malformed", () => {
    expect(toPastVisitDateBody({ ...EMPTY_PAST_VISIT_DATE, precision: "day" })).toBeNull();
    expect(
      toPastVisitDateBody({ ...EMPTY_PAST_VISIT_DATE, precision: "day", day: "12.03.2019" }),
    ).toBeNull();
    expect(toPastVisitDateBody({ ...EMPTY_PAST_VISIT_DATE, precision: "month" })).toBeNull();
    expect(
      toPastVisitDateBody({ ...EMPTY_PAST_VISIT_DATE, precision: "month", month: "03" }),
    ).toBeNull();
    expect(
      toPastVisitDateBody({
        ...EMPTY_PAST_VISIT_DATE,
        precision: "month",
        month: "13",
        monthYear: "2019",
      }),
    ).toBeNull();
    expect(
      toPastVisitDateBody({ ...EMPTY_PAST_VISIT_DATE, precision: "year", year: "19" }),
    ).toBeNull();
  });
});

describe("messages", () => {
  it("names the failure by status, for one place and for many", () => {
    expect(pastVisitFailureMessage(400, false)).toContain("Sprawdź datę");
    expect(pastVisitFailureMessage(401, true)).toContain("Sesja wygasła");
    expect(pastVisitFailureMessage(404, false)).toBe("To miejsce nie jest już dostępne.");
    expect(pastVisitFailureMessage(404, true)).toContain("Któreś z zaznaczonych miejsc");
    expect(pastVisitFailureMessage(429, false)).toContain("Za dużo prób");
    expect(pastVisitFailureMessage(500, false)).toContain("Nie udało się zapisać");
  });

  it("names the failure of a removal", () => {
    expect(pastVisitRemovalFailureMessage(401)).toContain("Sesja wygasła");
    expect(pastVisitRemovalFailureMessage(429)).toContain("Za dużo prób");
    expect(pastVisitRemovalFailureMessage(500)).toContain("Nie udało się usunąć");
  });

  it("counts what was saved and what was skipped, with Polish plurals", () => {
    expect(pastVisitSavedMessage(1, 0)).toBe("Zapisano 1 wizytę z przeszłości.");
    expect(pastVisitSavedMessage(2, 0)).toBe("Zapisano 2 wizyty z przeszłości.");
    expect(pastVisitSavedMessage(5, 0)).toBe("Zapisano 5 wizyt z przeszłości.");
    expect(pastVisitSavedMessage(12, 0)).toBe("Zapisano 12 wizyt z przeszłości.");
    expect(pastVisitSavedMessage(22, 0)).toBe("Zapisano 22 wizyty z przeszłości.");
    expect(pastVisitSavedMessage(2, 1)).toBe(
      "Zapisano 2 wizyty z przeszłości. Pominięto 1 miejsce z wcześniej zapisaną wizytą.",
    );
    expect(pastVisitSavedMessage(1, 3)).toContain("Pominięto 3 miejsca");
    expect(pastVisitSavedMessage(1, 5)).toContain("Pominięto 5 miejsc");
  });

  it("says when nothing was added because the places already had a visit", () => {
    expect(pastVisitSavedMessage(0, 1)).toContain("w tym miejscu");
    expect(pastVisitSavedMessage(0, 2)).toContain("w tych miejscach");
  });

  it("writes the badge of the place page", () => {
    expect(pastVisitBadgeText("marzec 2019")).toBe("Z przeszłości · marzec 2019");
  });
});
