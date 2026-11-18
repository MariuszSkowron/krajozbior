import "server-only";

import { isSameOrigin } from "@/features/identity/domain/origin";
import { getIdentityProvider } from "@/features/identity/infrastructure";
import { logFailure } from "@/lib/log-failure";

import { confirmOnSiteVisit } from "../application/confirm-on-site-visit";
import type { VisitResponse, VisitUseCaseOutcome } from "../application/visit-types";
import { VISIT_BODY_MAX_BYTES } from "../domain/limits";
import { getVisitDeps } from "../infrastructure/visit-deps";

// POST /api/places/[placeId]/visits: origin check, a bounded JSON body, the
// actor from the session and the mapping of the answer to a status. The body
// holds the position of the device: it is read here, handed to the use case
// and dropped; it is never logged (logFailure writes the error class only).

const HEADERS = { "Cache-Control": "private, no-store" };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...HEADERS, ...extra } });
}

// A body that is not JSON is passed on as `undefined`: the use case answers 401
// to a guest first and `invalid` (400) to a signed-in explorer.
async function readBody(request: Request): Promise<{ tooLarge: true } | { body: unknown }> {
  if (Number(request.headers.get("content-length") ?? "0") > VISIT_BODY_MAX_BYTES) {
    return { tooLarge: true };
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();

  while (reader !== undefined) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > VISIT_BODY_MAX_BYTES) {
      await reader.cancel();

      return { tooLarge: true };
    }

    chunks.push(value);
  }

  try {
    return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
  } catch {
    return { body: undefined };
  }
}

function respond(outcome: VisitUseCaseOutcome<VisitResponse>): Response {
  switch (outcome.status) {
    case "ok":
      return json(outcome.value.result === "recorded" ? 201 : 200, outcome.value);
    case "unauthenticated":
      return json(401, { error: "unauthenticated" });
    case "invalid":
      return json(400, { error: "invalid" });
    case "not_found":
      return json(404, { error: "not_found" });
    case "rate_limited":
      return json(
        429,
        { error: "rate_limited", message: "Za dużo prób, spróbuj za chwilę." },
        { "Retry-After": String(outcome.retryAfterSeconds) },
      );
  }
}

export async function handleVisitRequest(request: Request, placeId: string): Promise<Response> {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return json(403, { error: "forbidden_origin" });
  }

  try {
    const read = await readBody(request);

    if ("tooLarge" in read) {
      return json(413, { error: "payload_too_large" });
    }

    const actor = await getIdentityProvider().getActor(request.headers);

    return respond(await confirmOnSiteVisit(actor, placeId, read.body, getVisitDeps()));
  } catch (error) {
    logFailure("Visit request", error);

    return json(503, { error: "unavailable" });
  }
}
