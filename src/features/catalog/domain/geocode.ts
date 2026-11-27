// Address search in the place editor (K-2): the rules of the query and of the answer of the
// geocoding service. Pure functions; the request itself is in the infrastructure.

import type { ActionLimit } from "@/features/identity/domain/action-rate-limit";

export const GEOCODE_ACTION = "curator_geocode";
/** Searches of one curator: far above real use, far below what the public service tolerates. */
export const geocodeLimit: ActionLimit = { limit: 30, windowSeconds: 10 * 60 };

export const GEOCODE_QUERY_MIN_LENGTH = 3;
export const GEOCODE_QUERY_MAX_LENGTH = 200;
export const GEOCODE_MAX_RESULTS = 5;

export type GeocodeResult = Readonly<{ label: string; latitude: number; longitude: number }>;

/** The query without surrounding spaces, or `null` when it is not a text of a sensible size. */
export function normalizeGeocodeQuery(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const query = value.replace(/\s+/g, " ").trim();

  return query.length >= GEOCODE_QUERY_MIN_LENGTH && query.length <= GEOCODE_QUERY_MAX_LENGTH
    ? query
    : null;
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * Turns the JSON answer of the service (a list of `{ lat, lon, display_name }`) into at most
 * GEOCODE_MAX_RESULTS results. Anything that is not a place with a position in range is dropped,
 * so a strange answer gives an empty list, never an invalid pin.
 */
export function parseGeocodeResponse(payload: unknown): readonly GeocodeResult[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const results: GeocodeResult[] = [];

  for (const item of payload) {
    if (results.length === GEOCODE_MAX_RESULTS) {
      break;
    }

    if (typeof item !== "object" || item === null) {
      continue;
    }

    const { lat, lon, display_name: name } = item as Record<string, unknown>;
    const latitude = Number(lat);
    const longitude = Number(lon);

    if (
      typeof name !== "string" ||
      name.trim() === "" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      continue;
    }

    results.push({
      label: name.trim().slice(0, 300),
      latitude: round6(latitude),
      longitude: round6(longitude),
    });
  }

  return results;
}
