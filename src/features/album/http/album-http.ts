import "server-only";

import type { Actor } from "@/features/identity/domain/actor";
import { isSameOrigin } from "@/features/identity/domain/origin";
import { getIdentityProvider } from "@/features/identity/infrastructure";
import { logFailure } from "@/lib/log-failure";

import type { AlbumDeps, AlbumOutcome } from "../application/album-types";
import { getAlbumDeps } from "../infrastructure/album-deps";

// Shared by the /api/me album routes: origin check, the actor from the session,
// and the mapping of a use case answer to a status. Rules live in the use
// cases; nothing here decides who may do what. These routes take no body.

const HEADERS = { "Cache-Control": "private, no-store" };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...HEADERS, ...extra } });
}

export const notFound = (): Response => json(404, { error: "not_found" });

export function respond<T>(outcome: AlbumOutcome<T>): Response {
  switch (outcome.status) {
    case "ok":
      return json(200, outcome.value);
    case "unauthenticated":
      return json(401, { error: "unauthenticated" });
    case "not_found":
      return notFound();
    case "rate_limited":
      return json(
        429,
        { error: "rate_limited", message: "Za dużo zapisów, spróbuj za chwilę." },
        { "Retry-After": String(outcome.retryAfterSeconds) },
      );
  }
}

export async function handleAlbumWrite<T>(
  request: Request,
  run: (actor: Actor | null, deps: AlbumDeps) => Promise<AlbumOutcome<T>>,
): Promise<Response> {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return json(403, { error: "forbidden_origin" });
  }

  try {
    const actor = await getIdentityProvider().getActor(request.headers);

    return respond(await run(actor, getAlbumDeps()));
  } catch (error) {
    logFailure("Album request", error);

    return json(503, { error: "unavailable" });
  }
}
