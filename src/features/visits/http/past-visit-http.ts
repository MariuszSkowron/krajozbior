import "server-only";

import { isSameOrigin } from "@/features/identity/domain/origin";
import { getIdentityProvider } from "@/features/identity/infrastructure";
import { logFailure } from "@/lib/log-failure";

import { deleteMyPastVisit, markPastVisits } from "../application/mark-past-visits";
import type { VisitUseCaseOutcome } from "../application/visit-types";
import { PAST_VISIT_BODY_MAX_BYTES } from "../domain/limits";
import { getVisitDeps } from "../infrastructure/visit-deps";
import { privateJson as json, readJsonBody } from "./request-body";

// POST /api/me/visits/past and DELETE /api/me/visits/past/[placeId]: origin
// check, (for POST) a bounded JSON body, the actor from the session and the
// mapping of the answer to a status. Rules live in the use cases.

function respond<T>(outcome: VisitUseCaseOutcome<T>, ok: (value: T) => Response): Response {
  switch (outcome.status) {
    case "ok":
      return ok(outcome.value);
    case "unauthenticated":
      return json(401, { error: "unauthenticated" });
    case "invalid":
      return json(400, { error: "invalid" });
    case "not_found":
      return json(404, { error: "not_found" });
    case "rate_limited":
      return json(
        429,
        { error: "rate_limited", message: "Za dużo zapisów, spróbuj za chwilę." },
        { "Retry-After": String(outcome.retryAfterSeconds) },
      );
  }
}

const sameOrigin = (request: Request): boolean =>
  isSameOrigin(request.headers.get("origin"), request.headers.get("host"));

export async function handlePastVisitsRequest(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return json(403, { error: "forbidden_origin" });
  }

  try {
    const read = await readJsonBody(request, PAST_VISIT_BODY_MAX_BYTES);

    if ("tooLarge" in read) {
      return json(413, { error: "payload_too_large" });
    }

    const actor = await getIdentityProvider().getActor(request.headers);

    return respond(await markPastVisits(actor, read.body, getVisitDeps()), (value) =>
      json(201, value),
    );
  } catch (error) {
    logFailure("Past visit request", error);

    return json(503, { error: "unavailable" });
  }
}

export async function handleDeletePastVisit(request: Request, placeId: string): Promise<Response> {
  if (!sameOrigin(request)) {
    return json(403, { error: "forbidden_origin" });
  }

  try {
    const actor = await getIdentityProvider().getActor(request.headers);

    return respond(
      await deleteMyPastVisit(actor, placeId, getVisitDeps()),
      () => new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } }),
    );
  } catch (error) {
    logFailure("Past visit removal", error);

    return json(503, { error: "unavailable" });
  }
}
