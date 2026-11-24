// "Co dalej" po wizycie: które miejsce kolekcji odkrywca ma odwiedzić następne i jak to powiedzieć.
// Czyste funkcje, bez odczytów. Miejsca i położenia są publiczne (jak na stronie kolekcji);
// położenie urządzenia odkrywcy nie bierze w tym udziału: liczymy od miejsca właśnie odwiedzonego.

import { formatPlaceCount } from "@/features/catalog/domain/place-count";

export type NextPlaceCandidate = Readonly<{
  id: string;
  name: string;
  position: number;
  latitude: number;
  longitude: number;
}>;

const EARTH_RADIUS_KM = 6371.0088;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

function distanceKm(
  from: Readonly<{ latitude: number; longitude: number }>,
  to: Readonly<{ latitude: number; longitude: number }>,
): number {
  const dLat = radians(to.latitude - from.latitude);
  const dLon = radians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Następne miejsce kolekcji: najbliższe nieodwiedzone od miejsca `from` (równe odległości
 * rozstrzyga numer na liście). Bez `from` pierwsze nieodwiedzone z listy. Gdy wszystkie miejsca są
 * odwiedzone, `null`.
 */
export function nextPlaceToVisit(
  places: readonly NextPlaceCandidate[],
  visitedIds: ReadonlySet<string>,
  from: Readonly<{ latitude: number; longitude: number }> | null,
): Readonly<{ id: string; name: string }> | null {
  const open = places.filter((place) => !visitedIds.has(place.id));

  if (open.length === 0) {
    return null;
  }

  const ranked = [...open].sort(
    (a, b) =>
      (from === null ? 0 : distanceKm(from, a) - distanceKm(from, b)) || a.position - b.position,
  );
  const next = ranked[0]!;

  return { id: next.id, name: next.name };
}

/** Zdanie o postępie po wizycie, bez płci: „Zostało Ci 2 miejsca w kolekcji …”. */
export function remainingInCollectionText(
  progress: Readonly<{ visited: number; total: number }>,
  collectionTitle: string,
): string {
  const remaining = progress.total - progress.visited;

  return remaining <= 0
    ? `Masz wszystkie miejsca z kolekcji ${collectionTitle}.`
    : `Zostało Ci ${formatPlaceCount(remaining)} w kolekcji ${collectionTitle}.`;
}

/** Komunikat tuż po zapisanej wizycie: z nazwą miejsca, a bez niej zdanie ogólne. */
export function visitRecordedText(placeName: string | undefined): string {
  return `${placeName === undefined || placeName === "" ? "To miejsce" : placeName} jest w Twoim albumie.`;
}
