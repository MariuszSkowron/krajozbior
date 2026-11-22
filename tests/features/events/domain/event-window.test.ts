import { describe, expect, it } from "vitest";
import {
  EVENT_STATUSES,
  canChangeStatus,
  canDeleteEvent,
  canExtendEnd,
  coversDaytime,
  coversNight,
  eventEditRule,
  eventPhase,
  isInWindow,
  latestEventStart,
  validateEventWindow,
} from "@/features/events/domain/event-window";

const at = (iso: string) => new Date(iso);
const win = (startsAt: string, endsAt: string) => ({ startsAt: at(startsAt), endsAt: at(endsAt) });
const HOUR = 3600_000;

describe("window [from, to)", () => {
  const w = win("2027-05-01T10:00:00Z", "2027-05-01T12:00:00Z");

  it("includes the start and excludes the end", () => {
    expect(isInWindow(w, at("2027-05-01T09:59:59.999Z"))).toBe(false);
    expect(isInWindow(w, at("2027-05-01T10:00:00Z"))).toBe(true);
    expect(isInWindow(w, at("2027-05-01T11:59:59.999Z"))).toBe(true);
    expect(isInWindow(w, at("2027-05-01T12:00:00Z"))).toBe(false);
  });

  it("names the phase", () => {
    expect(eventPhase(w, at("2027-05-01T09:59:59Z"))).toBe("upcoming");
    expect(eventPhase(w, at("2027-05-01T10:00:00Z"))).toBe("running");
    expect(eventPhase(w, at("2027-05-01T12:00:00Z"))).toBe("ended");
  });

  it("keeps working across the October clock change (absolute instants)", () => {
    const night = win("2027-10-30T20:00:00Z", "2027-10-31T05:00:00Z");
    expect(isInWindow(night, at("2027-10-31T01:30:00Z"))).toBe(true);
    expect(isInWindow(night, at("2027-10-31T05:00:00Z"))).toBe(false);
  });
});

describe("validateEventWindow", () => {
  const now = at("2027-01-10T12:00:00Z");
  const start = at("2027-02-01T10:00:00Z");
  const ending = (ms: number) => ({ startsAt: start, endsAt: new Date(start.getTime() + ms) });

  it("accepts exactly 1 hour and exactly 14 days", () => {
    expect(validateEventWindow(ending(HOUR), now)).toEqual([]);
    expect(validateEventWindow(ending(14 * 24 * HOUR), now)).toEqual([]);
  });

  it("rejects 1 ms under an hour, zero and negative length, and 1 ms over 14 days", () => {
    expect(validateEventWindow(ending(HOUR - 1), now)).toEqual(["too_short"]);
    expect(validateEventWindow(ending(0), now)).toEqual(["too_short"]);
    expect(validateEventWindow(ending(-HOUR), now)).toEqual(["too_short"]);
    expect(validateEventWindow(ending(14 * 24 * HOUR + 1), now)).toEqual(["too_long"]);
  });

  it("allows a start exactly one year ahead and rejects 1 ms later", () => {
    const limit = latestEventStart(now);
    expect(limit).toEqual(at("2028-01-10T12:00:00Z"));
    const ok = { startsAt: limit, endsAt: new Date(limit.getTime() + HOUR) };
    expect(validateEventWindow(ok, now)).toEqual([]);
    const late = {
      startsAt: new Date(limit.getTime() + 1),
      endsAt: new Date(limit.getTime() + 1 + HOUR),
    };
    expect(validateEventWindow(late, now)).toEqual(["too_far_ahead"]);
  });

  it("reports several violations together and invalid dates alone", () => {
    const far = at("2029-01-01T00:00:00Z");
    expect(validateEventWindow({ startsAt: far, endsAt: far }, now)).toEqual([
      "too_short",
      "too_far_ahead",
    ]);
    expect(validateEventWindow({ startsAt: start, endsAt: new Date(NaN) }, now)).toEqual([
      "invalid_time",
    ]);
    expect(validateEventWindow({ startsAt: new Date(NaN), endsAt: start }, now)).toEqual([
      "invalid_time",
    ]);
    expect(validateEventWindow(ending(HOUR), new Date(NaN))).toEqual(["invalid_time"]);
  });
});

describe("coversNight (22:00-06:00 Polish time) and coversDaytime", () => {
  it("sees a window that ends exactly at 22:00 as daytime only (summer, 22:00 = 20:00Z)", () => {
    const w = win("2027-07-10T16:00:00Z", "2027-07-10T20:00:00Z");
    expect(coversNight(w)).toBe(false);
    expect(coversDaytime(w)).toBe(true);
  });

  it("sees a window one minute past 22:00 as touching the night", () => {
    expect(coversNight(win("2027-07-10T16:00:00Z", "2027-07-10T20:01:00Z"))).toBe(true);
  });

  it("sees a window that starts exactly at 06:00 as daytime only (summer, 06:00 = 04:00Z)", () => {
    const w = win("2027-07-10T04:00:00Z", "2027-07-10T10:00:00Z");
    expect(coversNight(w)).toBe(false);
    expect(coversDaytime(w)).toBe(true);
    expect(coversNight(win("2027-07-10T03:59:00Z", "2027-07-10T10:00:00Z"))).toBe(true);
  });

  it("uses winter offsets in winter (22:00 = 21:00Z)", () => {
    expect(coversNight(win("2027-01-10T15:00:00Z", "2027-01-10T21:00:00Z"))).toBe(false);
    expect(coversNight(win("2027-01-10T15:00:00Z", "2027-01-10T21:01:00Z"))).toBe(true);
  });

  it("recognises a night-only window and a night across midnight", () => {
    const w = win("2027-07-10T21:00:00Z", "2027-07-11T01:00:00Z"); // 23:00-03:00
    expect(coversNight(w)).toBe(true);
    expect(coversDaytime(w)).toBe(false);
  });

  it("covers both for a multi-day window", () => {
    const w = win("2027-07-10T08:00:00Z", "2027-07-12T08:00:00Z");
    expect(coversNight(w)).toBe(true);
    expect(coversDaytime(w)).toBe(true);
  });

  it("is right on days with a clock change", () => {
    // 28 March 2027: 22:00 Polish = 20:00Z (summer time already), 06:00 = 04:00Z.
    expect(coversNight(win("2027-03-28T10:00:00Z", "2027-03-28T20:00:00Z"))).toBe(false);
    expect(coversNight(win("2027-03-28T10:00:00Z", "2027-03-28T20:01:00Z"))).toBe(true);
    expect(coversNight(win("2027-03-28T04:00:00Z", "2027-03-28T10:00:00Z"))).toBe(false);
    // night 27->28 March: 22:00 = 21:00Z, 06:00 = 04:00Z
    expect(coversNight(win("2027-03-27T21:00:00Z", "2027-03-28T04:00:00Z"))).toBe(true);
    // 31 October 2027: 22:00 Polish = 21:00Z, 06:00 = 05:00Z.
    expect(coversNight(win("2027-10-31T05:00:00Z", "2027-10-31T21:00:00Z"))).toBe(false);
    expect(coversNight(win("2027-10-31T04:59:00Z", "2027-10-31T21:00:00Z"))).toBe(true);
    expect(coversNight(win("2027-10-31T10:00:00Z", "2027-10-31T21:01:00Z"))).toBe(true);
    expect(coversDaytime(win("2027-10-31T05:00:00Z", "2027-10-31T05:30:00Z"))).toBe(true);
  });
});

describe("status changes", () => {
  it("allows draft to announced and announced to cancelled before the end", () => {
    expect(canChangeStatus("draft", "announced", "upcoming")).toBe(true);
    expect(canChangeStatus("announced", "cancelled", "upcoming")).toBe(true);
    expect(canChangeStatus("announced", "cancelled", "running")).toBe(true);
  });

  it("refuses cancelling after the end and every other change", () => {
    expect(canChangeStatus("announced", "cancelled", "ended")).toBe(false);
    for (const from of EVENT_STATUSES) {
      for (const to of EVENT_STATUSES) {
        const allowed =
          (from === "draft" && to === "announced") || (from === "announced" && to === "cancelled");
        expect(canChangeStatus(from, to, "upcoming")).toBe(allowed);
      }
    }
  });
});

describe("edits, extending and deleting", () => {
  it("decides the edit rule by status and phase", () => {
    expect(eventEditRule("draft", "ended")).toBe("free");
    expect(eventEditRule("announced", "upcoming")).toBe("free");
    expect(eventEditRule("announced", "running")).toBe("extend_end_only");
    expect(eventEditRule("announced", "ended")).toBe("read_only");
    expect(eventEditRule("cancelled", "ended")).toBe("read_only");
  });

  it("extends the end only later and up to 14 days in total", () => {
    const w = win("2027-05-01T10:00:00Z", "2027-05-02T10:00:00Z");
    expect(canExtendEnd(w, at("2027-05-02T10:00:00.001Z"))).toBe(true);
    expect(canExtendEnd(w, at("2027-05-02T10:00:00Z"))).toBe(false);
    expect(canExtendEnd(w, at("2027-05-02T09:00:00Z"))).toBe(false);
    expect(canExtendEnd(w, at("2027-05-15T10:00:00Z"))).toBe(true);
    expect(canExtendEnd(w, at("2027-05-15T10:00:00.001Z"))).toBe(false);
  });

  it("deletes a draft always and other events only before the start", () => {
    expect(canDeleteEvent("draft", "ended")).toBe(true);
    expect(canDeleteEvent("announced", "upcoming")).toBe(true);
    expect(canDeleteEvent("announced", "running")).toBe(false);
    expect(canDeleteEvent("cancelled", "ended")).toBe(false);
  });
});
