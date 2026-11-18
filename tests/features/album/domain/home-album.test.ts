import { describe, expect, it } from "vitest";

import { describeVisit, type HomeRecentVisit } from "@/features/album/domain/home-album";

const base: HomeRecentVisit = {
  id: "v1",
  kind: "on_site",
  visitedAt: new Date("2026-11-17T23:30:00Z"),
  visitedOn: null,
  precision: null,
  place: { id: "p1", name: "Wieża ciśnień", address: "Tczew" },
};

describe("describeVisit", () => {
  it("shows the Polish day of a visit confirmed on site, with a link to the place", () => {
    expect(describeVisit(base)).toEqual({
      id: "v1",
      kindLabel: "potwierdzona na miejscu",
      dateText: "18 listopada 2026",
      place: { href: "/places/p1", name: "Wieża ciśnień", address: "Tczew" },
    });
  });

  it("shows the date given for a visit from the past with its precision", () => {
    expect(
      describeVisit({ ...base, kind: "past", visitedOn: "2019-03-01", precision: "month" }),
    ).toMatchObject({ kindLabel: "z przeszłości", dateText: "marzec 2019" });
    expect(
      describeVisit({ ...base, kind: "past", visitedOn: null, precision: "unknown" }).dateText,
    ).toBe("data nieznana");
  });

  it("falls back to the day of the record when a past visit has no precision", () => {
    expect(describeVisit({ ...base, kind: "past" }).dateText).toBe("18 listopada 2026");
  });

  it("gives no name, address or link for a place missing from the public catalog", () => {
    expect(describeVisit({ ...base, place: null }).place).toBeNull();
  });
});
