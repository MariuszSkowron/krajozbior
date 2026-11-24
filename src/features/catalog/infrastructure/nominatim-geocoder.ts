import "server-only";

import { GEOCODE_MAX_RESULTS, parseGeocodeResponse, type GeocodeResult } from "../domain/geocode";

// Address search through the public Nominatim service of OpenStreetMap. Its usage policy:
// at most 1 request per second, an identifying User-Agent, no autocomplete. Only the typed
// address text is sent (a public place's address, no personal data); the request comes from the
// server, so the curator's browser and address never reach the service.

// The 1 request per second is kept per server process (a chain of promises below); the limit per
// curator lives in PostgreSQL and holds across instances. With N instances the service could get
// up to N requests per second, which its policy forbids: before scaling out, move the clock to the
// database (an advisory lock plus the time of the last request) or use an own Nominatim server (D-60).
// The User-Agent names the application only; a contact address of the owner is an owner's decision.

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Krajozbior/1.0 (address search in the place editor)";
const MIN_GAP_MS = 1100;
const TIMEOUT_MS = 5000;
/** Searches waiting for their turn; more than this fails fast instead of piling up. */
const MAX_WAITING = 4;

export type Geocoder = (query: string) => Promise<readonly GeocodeResult[]>;

type Clock = Readonly<{ now: () => number; sleep: (ms: number) => Promise<void> }>;

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class GeocoderBusyError extends Error {}

/**
 * Builds a geocoder that keeps at least MIN_GAP_MS between requests of this process (a chain of
 * promises), whoever asks. `fetchImpl` and `clock` are injectable for tests.
 */
export function createNominatimGeocoder(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  clock: Clock = realClock,
): Geocoder {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = 0;
  let waiting = 0;

  async function request(query: string): Promise<readonly GeocodeResult[]> {
    const gap = lastStart + MIN_GAP_MS - clock.now();

    if (gap > 0) {
      await clock.sleep(gap);
    }

    lastStart = clock.now();

    const url = new URL(ENDPOINT);

    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(GEOCODE_MAX_RESULTS));
    url.searchParams.set("countrycodes", "pl");
    url.searchParams.set("accept-language", "pl");

    const response = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });

    if (!response.ok) {
      throw new Error(`Geocoder answered ${response.status}`);
    }

    return parseGeocodeResponse(await response.json());
  }

  return (query) => {
    if (waiting >= MAX_WAITING) {
      return Promise.reject(new GeocoderBusyError("Too many searches waiting"));
    }

    waiting += 1;

    const turn = tail.then(() => request(query));

    // The chain itself is never rejected: the caller handles the error of `turn`.
    tail = turn
      .finally(() => {
        waiting -= 1;
      })
      .catch(() => {});

    return turn;
  };
}

let shared: Geocoder | null = null;

export function getGeocoder(): Geocoder {
  shared ??= createNominatimGeocoder();

  return shared;
}
