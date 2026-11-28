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

/** A search answer is a few results; anything bigger than this is refused. */
const MAX_RESPONSE_BYTES = 256 * 1024;
/** After 429 or 403 no request is sent for this long. */
const PAUSE_AFTER_REFUSAL_MS = 5 * 60 * 1000;

/** Reads the body as text, or returns null when it is larger than `maxBytes`. */
async function readLimitedText(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);

    return null;
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.length;

    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);

      return null;
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(bytes);
}

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
  let pausedUntil = 0;

  async function request(query: string): Promise<readonly GeocodeResult[]> {
    if (clock.now() < pausedUntil) {
      throw new Error("Geocoder paused after a refusal");
    }

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

    if (response.status === 429 || response.status === 403) {
      // The service asks us to stop (or has blocked us): do not ask again for a few minutes.
      pausedUntil = clock.now() + PAUSE_AFTER_REFUSAL_MS;
      await response.body?.cancel().catch(() => undefined);

      throw new Error(`Geocoder answered ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`Geocoder answered ${response.status}`);
    }

    const text = await readLimitedText(response, MAX_RESPONSE_BYTES);

    if (text === null) {
      throw new Error("Geocoder answer too large");
    }

    return parseGeocodeResponse(JSON.parse(text));
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
