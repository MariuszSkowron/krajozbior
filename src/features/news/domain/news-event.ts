import { warsawToday } from "@/lib/time/warsaw-today";

import type { NewsKind } from "./news";

// The rule "ended" for events (spec E7, Q11): a day is a calendar day in
// Europe/Warsaw, whatever the zone of the server.

export type NewsEventDates = Readonly<{
  kind: NewsKind;
  /** `YYYY-MM-DD`; an event has it, other kinds do not. */
  eventStartsOn: string | null;
  /** `YYYY-MM-DD`, not earlier than the start; `null` when the event is one day. */
  eventEndsOn: string | null;
}>;

/**
 * An event is ended when its last day (the end, or the start when there is no end)
 * is before today in Poland. Other kinds, and an event without a start, are never ended.
 */
export function isNewsEventEnded(post: NewsEventDates, now: Date): boolean {
  if (post.kind !== "event" || post.eventStartsOn === null) {
    return false;
  }

  return (post.eventEndsOn ?? post.eventStartsOn) < warsawToday(now);
}

/**
 * The filter "Wydarzenia": events that are on or still to come, by start date
 * (ties by slug). The input is not changed.
 */
export function currentEvents<T extends NewsEventDates & { slug: string }>(
  posts: readonly T[],
  now: Date,
): T[] {
  return posts
    .filter((post) => post.kind === "event" && post.eventStartsOn !== null)
    .filter((post) => !isNewsEventEnded(post, now))
    .sort((a, b) => {
      const byStart = (a.eventStartsOn as string).localeCompare(b.eventStartsOn as string);

      return byStart !== 0 ? byStart : a.slug.localeCompare(b.slug);
    });
}
