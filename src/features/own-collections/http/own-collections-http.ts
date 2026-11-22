import "server-only";

import type { Actor } from "@/features/identity/domain/actor";
import { isSameOrigin } from "@/features/identity/domain/origin";
import { getIdentityProvider } from "@/features/identity/infrastructure";
import { privateJson as json, readJsonBody } from "@/features/visits/http/request-body";
import { logFailure } from "@/lib/log-failure";

import type {
  OwnCollectionsConflict,
  OwnCollectionsDeps,
  OwnCollectionsOutcome,
} from "../application/own-collection-types";
import { OWN_COLLECTION_BODY_MAX_BYTES } from "../domain/limits";
import { getOwnCollectionsDeps } from "../infrastructure/own-collections-deps";

// Shared by the /api/me/own-collections routes: origin check on a write, a bounded body, the actor
// from the session and the mapping of a use case answer to a status (401, 404, 409, 429 and so
// on). Rules live in the use cases; nothing here decides who may do what. Every answer is
// `private, no-store`, and the body is read, handed to the use case and dropped: never logged.

const CONFLICT_MESSAGES: Readonly<Record<OwnCollectionsConflict, string>> = {
  too_many_own_collections: "Masz już 50 własnych kolekcji. Usuń którąś, żeby dodać nową.",
  my_collections_full: "Masz już 200 kolekcji na liście. Usuń którąś, żeby dodać nową.",
  too_many_items: "W tej kolekcji jest już 200 miejsc. Usuń któreś, żeby dodać nowe.",
  stale_version: "Ta kolekcja zmieniła się w innym oknie. Odśwież stronę.",
};

export const notFound = (): Response => json(404, { error: "not_found" });

export function respond<T>(outcome: OwnCollectionsOutcome<T>): Response {
  switch (outcome.status) {
    case "ok":
      return json(200, outcome.value);
    case "unauthenticated":
      return json(401, { error: "unauthenticated" });
    case "not_found":
      return notFound();
    case "invalid":
      return json(400, { error: "invalid", fields: outcome.errors });
    case "conflict":
      return json(409, {
        error: "conflict",
        reason: outcome.reason,
        message: CONFLICT_MESSAGES[outcome.reason],
      });
    case "rate_limited":
      return json(
        429,
        { error: "rate_limited", message: "Za dużo zapisów, spróbuj za chwilę." },
        { "Retry-After": String(outcome.retryAfterSeconds) },
      );
  }
}

export type OwnCollectionsRun<T> = (
  actor: Actor | null,
  body: unknown,
  deps: OwnCollectionsDeps,
) => Promise<OwnCollectionsOutcome<T>>;

// One request: a write needs the same origin; the actor is the session of the request (null for a
// guest, which the use case turns into 401). A body is read only when the route takes one.
export async function handleOwnCollections<T>(
  request: Request,
  options: { write: boolean; withBody: boolean; run: OwnCollectionsRun<T> },
): Promise<Response> {
  if (options.write && !isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return json(403, { error: "forbidden_origin" });
  }

  try {
    const actor = await getIdentityProvider().getActor(request.headers);
    let body: unknown;

    // A guest is turned away before the body is read at all.
    if (options.withBody && actor !== null) {
      const read = await readJsonBody(request, OWN_COLLECTION_BODY_MAX_BYTES);

      if ("tooLarge" in read) {
        return json(413, { error: "payload_too_large" });
      }

      body = read.body;
    }

    return respond(await options.run(actor, body, getOwnCollectionsDeps()));
  } catch (error) {
    logFailure("Own collections request", error);

    return json(503, { error: "unavailable" });
  }
}
