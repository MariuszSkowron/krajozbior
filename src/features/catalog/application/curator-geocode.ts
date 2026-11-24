import {
  GEOCODE_ACTION,
  geocodeLimit,
  normalizeGeocodeQuery,
  type GeocodeResult,
} from "../domain/geocode";
import {
  AuthenticationRequiredError,
  requireActor,
  type Actor,
} from "@/features/identity/domain/actor";

import type { CatalogDeps, CuratorOutcome } from "./catalog-types";
import { inCuratorContext } from "./curator-runner";

/** The geocoding service: a failure is thrown (the route answers 503), no result is `[]`. */
export type Geocode = (query: string) => Promise<readonly GeocodeResult[]>;

// Address search of the place editor (K-2). Only a signed-in member of an approved organization
// may ask: the actor comes from the session, the limit is counted first (a refusal reveals
// nothing), then the membership is checked by the database. Nothing else than the typed address
// text goes to the service.
export async function searchAddress(
  actor: Actor | null,
  body: Record<string, unknown>,
  deps: CatalogDeps,
  geocode: Geocode,
): Promise<CuratorOutcome<{ results: readonly GeocodeResult[] }>> {
  let signedIn: Actor;

  try {
    signedIn = requireActor(actor);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { status: "unauthenticated" };
    }
    throw error;
  }

  const decision = await deps.limiter.reserve(GEOCODE_ACTION, signedIn.id, geocodeLimit);

  if (!decision.allowed) {
    return { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds };
  }

  // The database transaction only checks access and the query shape, then closes: the call to
  // the service (a queue of up to a few seconds plus the answer) must not hold a pooled
  // connection open.
  const checked = await inCuratorContext(signedIn, deps, async () => {
    const query = normalizeGeocodeQuery(body.query);

    if (query === null) {
      return { status: "invalid", errors: ["query"] } as const;
    }

    return { status: "ok", value: { query } } as const;
  });

  if (checked.status !== "ok") {
    return checked;
  }

  return { status: "ok", value: { results: await geocode(checked.value.query) } };
}
