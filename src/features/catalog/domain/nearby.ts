// "W okolicy" (E12-3, D-E12-9): the distance is counted in the browser, so the position of
// the device never reaches the server. Pure functions, no I/O.

/** The radius of "W okolicy" and the most collections shown (E12-Q4, [Z]). */
export const NEARBY_RADIUS_KM = 50;
export const NEARBY_LIMIT = 6;
/** Above this accuracy of a reading (in metres) the distances are said to be approximate. */
export const NEARBY_COARSE_ACCURACY_M = 5000;

const EARTH_RADIUS_KM = 6371.0088;

/** A public collection with the centre of its places; the server leaves out those without places. */
export type NearbyCandidate = Readonly<{
  slug: string;
  title: string;
  region: string;
  placeCount: number;
  centerLat: number | null;
  centerLon: number | null;
  /** ISO time of the first publication (used by "Nowa w okolicy", E12-6). */
  firstPublishedAt: string | null;
}>;

export type NearbyHit = Readonly<{ candidate: NearbyCandidate; distanceKm: number }>;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance between two points in kilometres (haversine, mean Earth radius). */
export function haversineKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const dLat = radians(latitudeB - latitudeA);
  const dLon = radians(longitudeB - longitudeA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

const isCoordinate = (value: number | null, limit: number): value is number =>
  value !== null && Number.isFinite(value) && Math.abs(value) <= limit;

/**
 * Collections whose centre lies within `radiusKm` (inclusive) of the position, nearest first
 * (ties by title, then slug), at most `limit`. An entry without valid coordinates is skipped;
 * an invalid position or a limit below 1 gives an empty list.
 */
export function nearbyCollections(
  candidates: readonly NearbyCandidate[],
  position: Readonly<{ latitude: number; longitude: number }>,
  radiusKm: number = NEARBY_RADIUS_KM,
  limit: number = NEARBY_LIMIT,
): readonly NearbyHit[] {
  if (
    !isCoordinate(position.latitude, 90) ||
    !isCoordinate(position.longitude, 180) ||
    !(limit >= 1)
  ) {
    return [];
  }

  const hits: NearbyHit[] = [];

  for (const candidate of candidates) {
    if (!isCoordinate(candidate.centerLat, 90) || !isCoordinate(candidate.centerLon, 180)) {
      continue;
    }

    const distanceKm = haversineKm(
      position.latitude,
      position.longitude,
      candidate.centerLat,
      candidate.centerLon,
    );

    if (distanceKm <= radiusKm) {
      hits.push({ candidate, distanceKm });
    }
  }

  hits.sort(
    (a, b) =>
      a.distanceKm - b.distanceKm ||
      a.candidate.title.localeCompare(b.candidate.title, "pl") ||
      a.candidate.slug.localeCompare(b.candidate.slug, "en"),
  );

  return hits.slice(0, Math.trunc(limit));
}

/** "Nowa w okolicy" (E12-Q6, [Z]): first published at most this many days ago. */
export const NEW_NEARBY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Nowa w okolicy": first published at most 30 days before `now` (the limit itself counts) and
 * within 50 km of the explorer (the limit itself counts). A collection never published, or with
 * an unreadable time, is not new. A time in the future (a clock skew) counts as just published.
 */
export function isNewNearby(
  firstPublishedAt: string | null,
  distanceKm: number,
  now: Date,
): boolean {
  if (firstPublishedAt === null || !(distanceKm <= NEARBY_RADIUS_KM)) {
    return false;
  }

  const publishedMs = Date.parse(firstPublishedAt);

  return !Number.isNaN(publishedMs) && now.getTime() - publishedMs <= NEW_NEARBY_DAYS * DAY_MS;
}

/** The text of the mark, shown with the card and read by a screen reader as it stands. */
export const NEW_NEARBY_LABEL = "Nowa w okolicy";

/** "12 km"; below a kilometre "poniżej 1 km". */
export function formatNearbyDistance(distanceKm: number): string {
  const rounded = Math.round(distanceKm);

  return rounded < 1 ? "poniżej 1 km" : `${rounded} km`;
}

/** Why the browser gave no position. */
export type NearbyProblem = "denied" | "unavailable" | "timeout" | "unsupported";

export function nearbyProblemMessage(problem: NearbyProblem): string {
  switch (problem) {
    case "denied":
      return "Nie mamy zgody na użycie lokalizacji. Włączysz ją w ustawieniach przeglądarki.";
    case "unavailable":
      return "Nie udało się ustalić Twojego położenia. Spróbuj ponownie.";
    case "timeout":
      return "Ustalanie położenia trwało zbyt długo. Spróbuj ponownie.";
    case "unsupported":
      return "Ta przeglądarka nie obsługuje lokalizacji.";
  }
}

/**
 * The message of a finished reading (K-34): the single list is sorted by distance; `count` is the
 * number of collections that have a known distance (a collection without places has none).
 */
export function nearbySortedMessage(count: number, coarse: boolean): string {
  if (count === 0) {
    return "Nie możemy jeszcze uporządkować kolekcji według odległości: żadna nie ma miejsc na mapie.";
  }

  const sorted = "Kolekcje od najbliższej.";

  return coarse ? `${sorted} Położenie jest niedokładne, więc odległości są przybliżone.` : sorted;
}
