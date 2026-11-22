import { EVENT_TIME_ZONE } from "./limits";

// Conversion between Polish wall-clock time and absolute instants, built on Intl
// (no time zone library). Absolute instants are what the database stores (timestamptz).

export type WarsawWallTime = Readonly<{
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
}>;

export type WarsawTimeResult =
  | Readonly<{ ok: true; instant: Date; ambiguous: boolean }>
  | Readonly<{ ok: false; reason: "invalid" | "nonexistent" }>;

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EVENT_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

const MINUTE_MS = 60 * 1000;
// Poland is on UTC+2 in summer and UTC+1 in winter; the summer offset gives the earlier instant.
const OFFSETS_MINUTES = [120, 60] as const;

/** The wall-clock reading in Warsaw at an instant. */
export function toWarsawWallTime(instant: Date): WarsawWallTime & Readonly<{ second: number }> {
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    parts[part.type] = Number(part.value);
  }

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function offsetMinutesAt(instant: Date): number {
  const wall = toWarsawWallTime(instant);
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );

  return Math.round((wallAsUtc - instant.getTime()) / MINUTE_MS);
}

/** Every instant that reads as this wall time in Warsaw, earliest first: none, one or two. */
function instantsFor(wall: WarsawWallTime): Date[] {
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const instants: Date[] = [];

  for (const offset of OFFSETS_MINUTES) {
    const candidate = new Date(wallAsUtc - offset * MINUTE_MS);
    if (offsetMinutesAt(candidate) === offset) {
      instants.push(candidate);
    }
  }

  return instants;
}

function isRealWallTime(wall: WarsawWallTime): boolean {
  const { year, month, day, hour, minute } = wall;
  if (![year, month, day, hour, minute].every(Number.isInteger)) {
    return false;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    year >= 1970 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Polish wall time to an instant (E6-Q6). A time that does not exist (the hour skipped
 * in March) is rejected; a time that happens twice (October) means its first occurrence,
 * and `ambiguous` tells the form to label it.
 */
export function warsawWallTimeToInstant(wall: WarsawWallTime): WarsawTimeResult {
  if (!isRealWallTime(wall)) {
    return { ok: false, reason: "invalid" };
  }
  const instants = instantsFor(wall);
  if (instants.length === 0) {
    return { ok: false, reason: "nonexistent" };
  }

  return { ok: true, instant: instants[0], ambiguous: instants.length === 2 };
}

/** Local midnight (00:00 in Warsaw) of the calendar day the given Warsaw date falls on. */
export function warsawMidnightOf(year: number, month: number, day: number): Date {
  // Poland never changes the clock at midnight, so 00:00 always exists exactly once.
  return instantsFor({ year, month, day, hour: 0, minute: 0 })[0];
}

/** Start of the Polish day that contains the instant (the daily card limit counts from here, D-E6-6). */
export function startOfWarsawDay(instant: Date): Date {
  const { year, month, day } = toWarsawWallTime(instant);

  return warsawMidnightOf(year, month, day);
}
