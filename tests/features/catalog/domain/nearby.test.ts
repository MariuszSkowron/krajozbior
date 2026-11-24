import { describe, expect, it } from "vitest";

import {
  NEARBY_LIMIT,
  NEARBY_RADIUS_KM,
  NEW_NEARBY_DAYS,
  formatNearbyDistance,
  distanceToNearestPlaceKm,
  haversineKm,
  isNewNearby,
  nearbyCollections,
  nearbyProblemMessage,
  nearbySortedMessage,
  type NearbyCandidate,
} from "@/features/catalog/domain/nearby";

// E12-3: "W okolicy" is counted in the browser (E12-Q4). Gdańsk and Tczew lie about 30 km apart.
const GDANSK = { latitude: 54.352, longitude: 18.6466 };
const TCZEW = { latitude: 54.0928, longitude: 18.7919 };

const entry = (
  slug: string,
  centerLat: number | null,
  centerLon: number | null,
  title = slug,
): NearbyCandidate => ({
  slug,
  title,
  region: "pomorskie",
  placeCount: 2,
  points: centerLat === null || centerLon === null ? [] : [[centerLat, centerLon]],
  firstPublishedAt: null,
});

// A collection with several places (R-067).
const several = (
  slug: string,
  points: readonly (readonly [number, number])[],
): NearbyCandidate => ({
  slug,
  title: slug,
  region: "pomorskie",
  placeCount: points.length,
  points,
  firstPublishedAt: null,
});

describe("haversineKm", () => {
  it("is zero for the same point and symmetric", () => {
    expect(haversineKm(54.1, 18.7, 54.1, 18.7)).toBe(0);
    expect(
      haversineKm(GDANSK.latitude, GDANSK.longitude, TCZEW.latitude, TCZEW.longitude),
    ).toBeCloseTo(
      haversineKm(TCZEW.latitude, TCZEW.longitude, GDANSK.latitude, GDANSK.longitude),
      9,
    );
  });

  it("gives the known distances", () => {
    // One degree of latitude is 111.2 km; Gdańsk - Tczew about 30 km; Warszawa - Kraków about 252 km.
    expect(haversineKm(50, 20, 51, 20)).toBeCloseTo(111.2, 1);
    expect(
      haversineKm(GDANSK.latitude, GDANSK.longitude, TCZEW.latitude, TCZEW.longitude),
    ).toBeGreaterThan(28);
    expect(
      haversineKm(GDANSK.latitude, GDANSK.longitude, TCZEW.latitude, TCZEW.longitude),
    ).toBeLessThan(32);
    expect(haversineKm(52.2297, 21.0122, 50.0647, 19.945)).toBeCloseTo(252, -1);
  });

  it("works across the antimeridian and between the poles", () => {
    expect(haversineKm(0, 179.5, 0, -179.5)).toBeCloseTo(111.2, 1);
    expect(haversineKm(90, 0, -90, 0)).toBeCloseTo(20015.1, 0);
  });
});

describe("nearbyCollections", () => {
  // One degree of latitude is 111.195 km, so 0.4496 degrees is 49.99 km and 0.4506 is 50.1 km.
  const origin = { latitude: 54, longitude: 18 };

  it("keeps the 50 km boundary inclusive and drops what lies beyond", () => {
    const inside = entry("w-promieniu", 54 + 0.4496, 18);
    const outside = entry("poza-promieniem", 54 + 0.4506, 18);
    const exact = haversineKm(54, 18, 54.2, 18);

    expect(nearbyCollections([inside, outside], origin).map((hit) => hit.candidate.slug)).toEqual([
      "w-promieniu",
    ]);
    // The radius itself belongs to the circle.
    expect(nearbyCollections([entry("na-granicy", 54.2, 18)], origin, exact)).toHaveLength(1);
    expect(nearbyCollections([entry("na-granicy", 54.2, 18)], origin, exact - 0.001)).toHaveLength(
      0,
    );
    expect(NEARBY_RADIUS_KM).toBe(50);
  });

  it("sorts nearest first, then by title, then by slug", () => {
    const list = [
      entry("daleko", 54.3, 18),
      entry("blisko", 54.05, 18),
      entry("remis-b", 54.1, 18, "Bbb"),
      entry("remis-a", 54.1, 18, "Aaa"),
      entry("remis-z2", 54.15, 18, "Ccc"),
      entry("remis-z1", 54.15, 18, "Ccc"),
    ];

    expect(nearbyCollections(list, origin).map((hit) => hit.candidate.slug)).toEqual([
      "blisko",
      "remis-a",
      "remis-b",
      "remis-z1",
      "remis-z2",
      "daleko",
    ]);
    // The same slug twice (never in real data) keeps both without a crash.
    expect(nearbyCollections([entry("x", 54.1, 18), entry("x", 54.1, 18)], origin)).toHaveLength(2);
    expect(
      nearbyCollections([entry("b", 54.1, 18), entry("a", 54.1, 18)], origin)[0]?.candidate.slug,
    ).toBe("a");
  });

  it("returns the distance with every hit", () => {
    const [hit] = nearbyCollections([entry("jedna", 54.1, 18)], origin);

    expect(hit?.distanceKm).toBeCloseTo(11.12, 1);
  });

  it("shows at most six collections by default and honours another limit", () => {
    const list = Array.from({ length: 9 }, (_, i) => entry(`k-${i}`, 54 + i / 100, 18));

    expect(NEARBY_LIMIT).toBe(6);
    expect(nearbyCollections(list, origin)).toHaveLength(6);
    expect(nearbyCollections(list, origin, 50, 2.9).map((hit) => hit.candidate.slug)).toEqual([
      "k-0",
      "k-1",
    ]);
    expect(nearbyCollections(list, origin, 50, 0)).toEqual([]);
    expect(nearbyCollections(list, origin, 50, Number.NaN)).toEqual([]);
  });

  it("measures to the nearest place of the collection, not to its middle (R-067)", () => {
    // Two castles 200 km apart: the middle lies 100 km from both, but at one of them the
    // explorer stands (about 100 m away).
    const spread = several("zamki", [
      [54, 18],
      [54, 20.5],
    ]);
    const standingAtCastle = { latitude: 54.0009, longitude: 18 };
    const [hit] = nearbyCollections([spread], standingAtCastle);

    expect(hit?.distanceKm).toBeLessThan(1);
    expect(distanceToNearestPlaceKm(spread, standingAtCastle)).toBeLessThan(1);
    expect(formatNearbyDistance(hit!.distanceKm)).toBe("poniżej 1 km");
    // The old rule (the mean of the places) said about 74 km here: out of the 50 km circle.
    expect(haversineKm(54.0009, 18, 54, 19.25)).toBeGreaterThan(NEARBY_RADIUS_KM);
  });

  it("uses the nearest of the places that have valid coordinates and skips the others", () => {
    const mixed = several("mieszana", [
      [Number.NaN, 18],
      [95, 18],
      [54.2, 18],
    ]);

    expect(distanceToNearestPlaceKm(mixed, origin)).toBeCloseTo(haversineKm(54, 18, 54.2, 18), 9);
    expect(distanceToNearestPlaceKm(several("brak", []), origin)).toBeNull();
    expect(distanceToNearestPlaceKm(several("zle", [[91, 18]]), origin)).toBeNull();
  });

  it("gives an empty list for an empty list of collections", () => {
    expect(nearbyCollections([], origin)).toEqual([]);
  });

  it("skips an entry without coordinates or with coordinates out of range", () => {
    const list = [
      entry("bez-szerokosci", null, 18),
      entry("bez-dlugosci", 54, null),
      entry("nan", Number.NaN, 18),
      entry("za-duza-szerokosc", 91, 18),
      entry("za-duza-dlugosc", 54, 181),
      entry("ok", 54, 18),
    ];

    expect(nearbyCollections(list, origin).map((hit) => hit.candidate.slug)).toEqual(["ok"]);
  });

  it("gives nothing for a position that is not a position", () => {
    const list = [entry("ok", 54, 18)];

    expect(nearbyCollections(list, { latitude: Number.NaN, longitude: 18 })).toEqual([]);
    expect(nearbyCollections(list, { latitude: 54, longitude: Number.POSITIVE_INFINITY })).toEqual(
      [],
    );
    expect(nearbyCollections(list, { latitude: 95, longitude: 18 })).toEqual([]);
    expect(nearbyCollections(list, { latitude: 54, longitude: -181 })).toEqual([]);
  });
});

describe("texts of W okolicy", () => {
  it("formats the distance in whole kilometres, below one kilometre as a phrase", () => {
    expect(formatNearbyDistance(0.2)).toBe("poniżej 1 km");
    expect(formatNearbyDistance(0.49)).toBe("poniżej 1 km");
    expect(formatNearbyDistance(0.5)).toBe("1 km");
    expect(formatNearbyDistance(12.4)).toBe("12 km");
    expect(formatNearbyDistance(49.6)).toBe("50 km");
  });

  it("names every problem in Polish", () => {
    expect(nearbyProblemMessage("denied")).toBe(
      "Nie mamy zgody na lokalizację. Zezwól na nią w ustawieniach przeglądarki.",
    );
    expect(nearbyProblemMessage("unavailable")).toContain("Nie udało się ustalić");
    expect(nearbyProblemMessage("timeout")).toContain("zbyt długo");
    expect(nearbyProblemMessage("unsupported")).toBe("Ta przeglądarka nie obsługuje lokalizacji.");
  });

  it("says the list is sorted, with a note when the reading is coarse", () => {
    expect(nearbySortedMessage(4, false)).toBe("Kolekcje od najbliższej.");
    expect(nearbySortedMessage(1, true)).toBe(
      "Kolekcje od najbliższej. Położenie jest niedokładne, więc odległości są przybliżone.",
    );
    // Without any known distance there is nothing to sort, and no note about accuracy.
    expect(nearbySortedMessage(0, false)).toContain("żadna nie ma miejsc na mapie");
    expect(nearbySortedMessage(0, true)).not.toContain("niedokładna");
  });
});

// E12-S4 / E12-Q6: "Nowa w okolicy" = first published at most 30 days ago and at most 50 km away.
describe("isNewNearby", () => {
  const NOW = new Date("2026-11-21T12:00:00.000Z");
  const daysAgo = (days: number, extraMs = 0) =>
    new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000 - extraMs).toISOString();

  it("counts exactly 30 days as new and a millisecond more as not new", () => {
    expect(isNewNearby(daysAgo(30), 10, NOW)).toBe(true);
    expect(isNewNearby(daysAgo(30, 1), 10, NOW)).toBe(false);
    expect(isNewNearby(daysAgo(29), 10, NOW)).toBe(true);
    expect(isNewNearby(daysAgo(0), 10, NOW)).toBe(true);
    expect(NEW_NEARBY_DAYS).toBe(30);
  });

  it("counts exactly 50 km as near and anything farther as not", () => {
    expect(isNewNearby(daysAgo(1), NEARBY_RADIUS_KM, NOW)).toBe(true);
    expect(isNewNearby(daysAgo(1), NEARBY_RADIUS_KM + 0.001, NOW)).toBe(false);
    expect(isNewNearby(daysAgo(1), 0, NOW)).toBe(true);
    expect(isNewNearby(daysAgo(1), Number.NaN, NOW)).toBe(false);
  });

  it("needs both rules at once", () => {
    expect(isNewNearby(daysAgo(31), 10, NOW)).toBe(false);
    expect(isNewNearby(daysAgo(31), 60, NOW)).toBe(false);
    expect(isNewNearby(daysAgo(1), 60, NOW)).toBe(false);
  });

  it("is not new without a readable first publication, and treats the future as just published", () => {
    expect(isNewNearby(null, 10, NOW)).toBe(false);
    expect(isNewNearby("nie data", 10, NOW)).toBe(false);
    expect(isNewNearby(daysAgo(-2), 10, NOW)).toBe(true);
  });
});
