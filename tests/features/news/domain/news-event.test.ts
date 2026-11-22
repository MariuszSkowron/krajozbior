import { describe, expect, it } from "vitest";

import {
  currentEvents,
  isNewsEventEnded,
  type NewsEventDates,
} from "@/features/news/domain/news-event";

const event = (start: string | null, end: string | null = null): NewsEventDates => ({
  kind: "event",
  eventStartsOn: start,
  eventEndsOn: end,
});

describe("isNewsEventEnded (zone Europe/Warsaw)", () => {
  it("is not ended on its last day, and ended the day after", () => {
    expect(isNewsEventEnded(event("2027-05-10"), new Date("2027-05-10T10:00:00Z"))).toBe(false);
    expect(isNewsEventEnded(event("2027-05-10"), new Date("2027-05-11T10:00:00Z"))).toBe(true);
  });

  it("uses the end date when there is one", () => {
    const multi = event("2027-05-10", "2027-05-12");

    expect(isNewsEventEnded(multi, new Date("2027-05-12T10:00:00Z"))).toBe(false);
    expect(isNewsEventEnded(multi, new Date("2027-05-13T10:00:00Z"))).toBe(true);
  });

  it("counts the day in Poland: just after midnight there is already the next day", () => {
    // Summer time, UTC+2: 22:30 UTC on May 10 is 00:30 on May 11 in Poland.
    expect(isNewsEventEnded(event("2027-05-10"), new Date("2027-05-10T21:59:00Z"))).toBe(false);
    expect(isNewsEventEnded(event("2027-05-10"), new Date("2027-05-10T22:00:00Z"))).toBe(true);
    // Winter time, UTC+1.
    expect(isNewsEventEnded(event("2027-01-10"), new Date("2027-01-10T22:59:00Z"))).toBe(false);
    expect(isNewsEventEnded(event("2027-01-10"), new Date("2027-01-10T23:00:00Z"))).toBe(true);
  });

  it("is never ended for another kind or for an event without a start", () => {
    const now = new Date("2030-01-01T00:00:00Z");

    expect(isNewsEventEnded({ ...event("2020-01-01"), kind: "guide" }, now)).toBe(false);
    expect(isNewsEventEnded(event(null), now)).toBe(false);
  });
});

describe("currentEvents", () => {
  const now = new Date("2027-05-10T10:00:00Z");
  const post = (slug: string, dates: NewsEventDates) => ({ slug, ...dates });

  it("keeps ongoing and future events, sorted by start then by slug, and drops the rest", () => {
    const posts = [
      post("pozniej", event("2027-06-01")),
      post("zakonczone", event("2027-05-01", "2027-05-09")),
      post("trwa", event("2027-05-08", "2027-05-12")),
      post("b-dzis", event("2027-05-10")),
      post("a-dzis", event("2027-05-10")),
      post("poradnik", { ...event("2027-05-20"), kind: "guide" }),
      post("bez-daty", event(null)),
    ];
    const copy = [...posts];

    expect(currentEvents(posts, now).map((p) => p.slug)).toEqual([
      "trwa",
      "a-dzis",
      "b-dzis",
      "pozniej",
    ]);
    expect(posts).toEqual(copy);
  });

  it("returns an empty list for no events", () => {
    expect(currentEvents([], now)).toEqual([]);
  });
});
