import {
  EVENT_MAX_DURATION_MS,
  EVENT_MAX_YEARS_AHEAD,
  EVENT_MIN_DURATION_MS,
  EVENT_NIGHT_END_HOUR,
  EVENT_NIGHT_START_HOUR,
} from "./limits";
import { toWarsawWallTime, warsawMidnightOf, warsawWallTimeToInstant } from "./polish-time";

// The time rules of an event (E6-Q6, E6-Q7, E6-Q16). Instants are absolute; the window
// is half-open: `startsAt <= now < endsAt`, no tolerance after the end.

export type EventWindow = Readonly<{ startsAt: Date; endsAt: Date }>;

export const EVENT_STATUSES = ["draft", "announced", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type EventPhase = "upcoming" | "running" | "ended";

export type EventWindowViolation = "invalid_time" | "too_short" | "too_long" | "too_far_ahead";

const DAY_MS = 24 * 60 * 60 * 1000;

export function isInWindow(window: EventWindow, now: Date): boolean {
  return window.startsAt.getTime() <= now.getTime() && now.getTime() < window.endsAt.getTime();
}

export function eventPhase(window: EventWindow, now: Date): EventPhase {
  if (now.getTime() < window.startsAt.getTime()) {
    return "upcoming";
  }

  return now.getTime() < window.endsAt.getTime() ? "running" : "ended";
}

/**
 * The latest start a new event may have: one year after `now` on the Polish wall clock
 * (same date and time next year). A day that does not exist next year (29 Feb) becomes the
 * last day of the month (28 Feb). A wall time skipped by the March clock change moves one
 * hour forward (02:30 -> 03:30); a wall time that happens twice in October means its first
 * occurrence, like everywhere in this module. SQL equivalent (E6-1a):
 * `((t at time zone 'Europe/Warsaw') + interval '1 year') at time zone 'Europe/Warsaw'`.
 */
export function latestEventStart(now: Date): Date {
  if (Number.isNaN(now.getTime())) {
    return new Date(NaN);
  }
  const wall = toWarsawWallTime(now);
  const year = wall.year + EVENT_MAX_YEARS_AHEAD;
  const lastDay = new Date(Date.UTC(year, wall.month, 0)).getUTCDate();
  const day = Math.min(wall.day, lastDay);
  const subMinuteMs = wall.second * 1000 + (((now.getTime() % 1000) + 1000) % 1000);

  let result = warsawWallTimeToInstant({ ...wall, year, day });
  if (!result.ok && result.reason === "nonexistent") {
    // Skipped hour: continue one hour later (the wall time cannot cross midnight here).
    result = warsawWallTimeToInstant({ ...wall, year, day, hour: wall.hour + 1 });
  }
  // Year before 1970 on the Polish clock (or out of the Date range): no valid limit.
  if (!result.ok) {
    return new Date(NaN);
  }

  return new Date(result.instant.getTime() + subMinuteMs);
}

/** Length from 1 hour to 14 days (both inclusive) and a start at most one year ahead. */
export function validateEventWindow(window: EventWindow, now: Date): EventWindowViolation[] {
  const start = window.startsAt.getTime();
  const end = window.endsAt.getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(now.getTime())) {
    return ["invalid_time"];
  }

  const latestStart = latestEventStart(now).getTime();
  if (Number.isNaN(latestStart)) {
    // The one-year limit cannot be computed: refuse instead of letting every start pass.
    return ["invalid_time"];
  }

  const violations: EventWindowViolation[] = [];
  const duration = end - start;
  if (duration < EVENT_MIN_DURATION_MS) {
    violations.push("too_short");
  }
  if (duration > EVENT_MAX_DURATION_MS) {
    violations.push("too_long");
  }
  if (start > latestStart) {
    violations.push("too_far_ahead");
  }

  return violations;
}

// Does the window touch any instant in [from, to) on some Polish calendar day, where the
// range runs from `fromHour` of day D to `toHour` of day D + `toDayOffset`?
function touchesDailyRange(
  window: EventWindow,
  fromHour: number,
  toHour: number,
  toDayOffset: number,
): boolean {
  const first = toWarsawWallTime(window.startsAt);
  const last = toWarsawWallTime(window.endsAt);
  const firstDay = Date.UTC(first.year, first.month - 1, first.day) - DAY_MS;
  const lastDay = Date.UTC(last.year, last.month - 1, last.day);

  for (let day = firstDay; day <= lastDay; day += DAY_MS) {
    const from = new Date(day);
    const to = new Date(day + toDayOffset * DAY_MS);
    const rangeStart = warsawMidnightOf(
      from.getUTCFullYear(),
      from.getUTCMonth() + 1,
      from.getUTCDate(),
    );
    const rangeEnd = warsawMidnightOf(to.getUTCFullYear(), to.getUTCMonth() + 1, to.getUTCDate());
    // Hours are wall-clock hours: on clock-change days add the 1 h difference (dstShift) so
    // 06:00 and 22:00 stay local; on ordinary days the shift is 0.
    const start = rangeStart.getTime() + fromHour * 3600_000 + dstShift(rangeStart, fromHour);
    const end = rangeEnd.getTime() + toHour * 3600_000 + dstShift(rangeEnd, toHour);
    if (window.startsAt.getTime() < end && window.endsAt.getTime() > start) {
      return true;
    }
  }

  return false;
}

// Correction when the clock changed between local midnight and `hour` on that day.
function dstShift(midnight: Date, hour: number): number {
  const at = new Date(midnight.getTime() + hour * 3600_000);

  return (hour - toWarsawWallTime(at).hour) * 3600_000;
}

/** The window includes some time between 22:00 and 06:00 Polish time (E6-Q16). */
export function coversNight(window: EventWindow): boolean {
  return touchesDailyRange(window, EVENT_NIGHT_START_HOUR, EVENT_NIGHT_END_HOUR, 1);
}

/** The window includes some time between 06:00 and 22:00 Polish time (the "also by day" sentence). */
export function coversDaytime(window: EventWindow): boolean {
  return touchesDailyRange(window, EVENT_NIGHT_END_HOUR, EVENT_NIGHT_START_HOUR, 0);
}

/** Allowed status changes: a draft is announced, an announced event is cancelled; nothing else. */
export function canChangeStatus(from: EventStatus, to: EventStatus, phase: EventPhase): boolean {
  // A draft is announced only before it starts (D-E6-4: no changes after the start).
  if (from === "draft" && to === "announced") {
    return phase === "upcoming";
  }

  // An event that already ended is read-only, so it cannot be cancelled either.
  return from === "announced" && to === "cancelled" && phase !== "ended";
}

export type EventEditRule = "free" | "extend_end_only" | "read_only";

/**
 * What may change in the times of an event (E6-Q6, D-E6-4): by phase, drafts included.
 * `_status` stays in the signature on purpose: the rule is the same for every status
 * after the review, and callers keep passing it.
 */
export function eventEditRule(_status: EventStatus, phase: EventPhase): EventEditRule {
  if (phase === "upcoming") {
    return "free";
  }

  return phase === "running" ? "extend_end_only" : "read_only";
}

/** A running event may only get a later end, within the 14-day limit. */
export function canExtendEnd(window: EventWindow, newEndsAt: Date): boolean {
  const newEnd = newEndsAt.getTime();

  return (
    newEnd > window.endsAt.getTime() && newEnd - window.startsAt.getTime() <= EVENT_MAX_DURATION_MS
  );
}

/** A draft may always be deleted; any other event only before it starts (D-E6-10). */
export function canDeleteEvent(status: EventStatus, phase: EventPhase): boolean {
  return status === "draft" || phase === "upcoming";
}
