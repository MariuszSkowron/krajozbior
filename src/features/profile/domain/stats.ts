import { haversineKm } from "@/features/catalog/domain/nearby";

// The numbers of the profile (E9-3). Pure functions, no I/O. The application keeps
// no track and no position of the device (D-14): everything here is counted from
// the stored places and the server times of the visits.

/** The day is counted in the time of Poland, whatever the zone of the server. */
export const STATS_TIME_ZONE = "Europe/Warsaw";

/** A visit as the statistics need it: the kind, the server time and the place it points at. */
export type StatsVisit = Readonly<{
  kind: "on_site" | "past";
  /** A timestamp the database stored (ISO text or a `Date`). */
  visitedAt: string | Date;
  latitude: number;
  longitude: number;
}>;

/** What the profile shows. */
export type ProfileStats = Readonly<{
  visitedPlaces: number;
  regions: number;
  kmInTransit: number;
}>;

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: STATS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const isCoordinate = (value: number, limit: number) =>
  Number.isFinite(value) && Math.abs(value) <= limit;

/** The calendar day (`YYYY-MM-DD`) of a moment in `Europe/Warsaw`; `null` for an invalid time. */
export function warsawDay(moment: string | Date): string | null {
  const time = moment instanceof Date ? moment : new Date(moment);

  return Number.isNaN(time.getTime()) ? null : dayFormat.format(time);
}

/**
 * "Km w trasie": the sum of straight-line distances between consecutive visits
 * confirmed on site, counted day by day. A day is a calendar day in `Europe/Warsaw`,
 * so the first visit of a day starts a new leg and nothing is added between days.
 * Visits from the past are skipped, as is a visit without a valid time or place.
 */
export function kmInTransit(visits: readonly StatsVisit[]): number {
  const days = new Map<string, { time: number; latitude: number; longitude: number }[]>();

  for (const visit of visits) {
    if (visit.kind !== "on_site") {
      continue;
    }

    const day = warsawDay(visit.visitedAt);

    if (day === null || !isCoordinate(visit.latitude, 90) || !isCoordinate(visit.longitude, 180)) {
      continue;
    }

    const stops = days.get(day) ?? [];

    stops.push({
      time: new Date(visit.visitedAt).getTime(),
      latitude: visit.latitude,
      longitude: visit.longitude,
    });
    days.set(day, stops);
  }

  let total = 0;

  for (const stops of days.values()) {
    // Array.prototype.sort is stable, so visits of the same instant keep their order.
    stops.sort((a, b) => a.time - b.time);

    for (let i = 1; i < stops.length; i += 1) {
      const from = stops[i - 1]!;
      const to = stops[i]!;

      total += haversineKm(from.latitude, from.longitude, to.latitude, to.longitude);
    }
  }

  return total;
}

const kmFormat = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 });

/** A number of kilometres for the screen: one decimal at most, Polish separators. */
export function formatKm(km: number): string {
  return kmFormat.format(Number.isFinite(km) && km > 0 ? km : 0);
}
