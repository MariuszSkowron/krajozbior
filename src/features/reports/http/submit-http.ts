import "server-only";

import type { Actor } from "@/features/identity/domain/actor";
import { isSameOrigin } from "@/features/identity/domain/origin";
import { getIdentityProvider } from "@/features/identity/infrastructure";
import { privateJson as json, readJsonBody } from "@/features/visits/http/request-body";
import { isPlaceReportsEnabled } from "@/lib/config/env";
import { logFailure } from "@/lib/log-failure";

import { submitPlaceReport } from "../application/explorer-reports";
import type { ReportsDeps } from "../application/report-types";
import {
  BURST_LIMIT_MESSAGE,
  DAILY_LIMIT_MESSAGE,
  DUPLICATE_OPEN_MESSAGE,
  OPEN_LIMIT_MESSAGE,
  PLACE_QUEUE_FULL_MESSAGE,
} from "../domain/report-texts";
import { REPORT_BODY_MAX_BYTES } from "../domain/limits";
import { getReportsDeps } from "../infrastructure/reports-deps";

// POST /api/places/[placeId]/reports: the first step is the switch (off: 404 before the session,
// the origin or the body is read, so nothing can be sent around it), then the origin check, a
// bounded JSON body, the actor from the session and the mapping of the answer. The body holds the
// text of the explorer: it is read here, handed to the use case and dropped; it is never logged.

type Dependencies = Readonly<{
  enabled: () => boolean;
  getActor: (headers: Headers) => Promise<Actor | null>;
  deps: () => ReportsDeps;
}>;

const defaults: Dependencies = {
  enabled: () => isPlaceReportsEnabled(),
  getActor: (headers) => getIdentityProvider().getActor(headers),
  deps: getReportsDeps,
};

export async function handleSubmitReport(
  request: Request,
  placeId: string,
  dependencies: Dependencies = defaults,
): Promise<Response> {
  if (!dependencies.enabled()) {
    return json(404, { error: "not_found" });
  }

  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return json(403, { error: "forbidden_origin" });
  }

  try {
    const read = await readJsonBody(request, REPORT_BODY_MAX_BYTES);

    if ("tooLarge" in read) {
      return json(413, { error: "payload_too_large" });
    }

    const actor = await dependencies.getActor(request.headers);
    const body =
      typeof read.body === "object" && read.body !== null && !Array.isArray(read.body)
        ? (read.body as Record<string, unknown>)
        : {};
    const outcome = await submitPlaceReport(actor, placeId, body, dependencies.deps());

    switch (outcome.status) {
      case "ok":
        return json(201, outcome.value);
      case "unauthenticated":
        return json(401, { error: "unauthenticated" });
      case "not_found":
        return json(404, { error: "not_found" });
      case "own_organization":
        return json(403, { error: "own_organization" });
      case "invalid":
        return json(422, { error: "invalid", fields: outcome.errors });
      case "rate_limited":
        return json(
          429,
          {
            error: "rate_limited",
            message:
              outcome.reason === "daily"
                ? DAILY_LIMIT_MESSAGE
                : outcome.reason === "open"
                  ? OPEN_LIMIT_MESSAGE
                  : BURST_LIMIT_MESSAGE,
          },
          outcome.retryAfterSeconds === undefined
            ? {}
            : { "Retry-After": String(outcome.retryAfterSeconds) },
        );
      case "place_queue_full":
        return json(409, { error: "place_queue_full", message: PLACE_QUEUE_FULL_MESSAGE });
      case "duplicate_open":
        return json(409, { error: "duplicate_open", message: DUPLICATE_OPEN_MESSAGE });
    }
  } catch (error) {
    logFailure("Place report", error);

    return json(503, { error: "unavailable" });
  }
}
