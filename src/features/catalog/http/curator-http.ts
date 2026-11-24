import "server-only";

import type { Actor } from "@/features/identity/domain/actor";
import { isSameOrigin } from "@/features/identity/domain/origin";
import { getIdentityProvider } from "@/features/identity/infrastructure";
import { logFailure } from "@/lib/log-failure";

import type { CatalogDeps, CuratorOutcome } from "../application/catalog-types";
import { getCatalogDeps } from "../infrastructure/catalog-deps";
import { CURATOR_BODY_MAX_BYTES } from "../domain/limits";
import { isUuid } from "../domain/uuid";

// Shared by the /api/curator routes: origin check, bounded JSON body, the
// actor from the session, and the mapping of a use case answer to a status.
// Rules live in the use cases; nothing here decides who may do what.

const HEADERS = { "Cache-Control": "private, no-store" };

export { isUuid };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...HEADERS, ...extra } });
}

export const notFound = (): Response => json(404, { error: "not_found" });

type Body = { ok: true; value: Record<string, unknown> } | { ok: false; response: Response };

// Reads at most CURATOR_BODY_MAX_BYTES; a bigger body is cut off, not buffered.
async function readBody(request: Request): Promise<Body> {
  const declared = Number(request.headers.get("content-length") ?? "0");

  if (declared > CURATOR_BODY_MAX_BYTES) {
    return { ok: false, response: json(413, { error: "payload_too_large" }) };
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

    if (size > CURATOR_BODY_MAX_BYTES) {
      await reader.cancel();

      return { ok: false, response: json(413, { error: "payload_too_large" }) };
    }

    chunks.push(value);
  }

  if (size === 0) {
    return { ok: true, value: {} };
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
  } catch {
    // falls through to the same answer as a non-object body
  }

  return { ok: false, response: json(400, { error: "invalid_json" }) };
}

const STALE_MESSAGE = "Ktoś zmienił tę kolekcję, odśwież";

export function respond<T>(outcome: CuratorOutcome<T>, successStatus: number): Response {
  switch (outcome.status) {
    case "ok":
      return successStatus === 204
        ? new Response(null, { status: 204, headers: HEADERS })
        : json(successStatus, outcome.value);
    case "unauthenticated":
      return json(401, { error: "unauthenticated" });
    case "forbidden":
      return json(403, { error: "forbidden" });
    case "not_found":
      return notFound();
    case "rate_limited":
      return json(
        429,
        { error: "rate_limited", message: "Za dużo prób w krótkim czasie, spróbuj za chwilę." },
        { "Retry-After": String(outcome.retryAfterSeconds) },
      );
    case "invalid":
      return json(400, { error: "invalid", fields: outcome.errors });
    case "conflict":
      return json(409, {
        error: "conflict",
        reason: outcome.reason,
        ...(outcome.reason === "stale_version" ? { message: STALE_MESSAGE } : {}),
      });
    case "unprocessable":
      return json(422, { error: "unprocessable", reason: outcome.reason });
  }
}

export type CuratorRun<T> = (
  actor: Actor | null,
  body: Record<string, unknown>,
  deps: CatalogDeps,
) => Promise<CuratorOutcome<T>>;

// One curator request: a write needs the same origin; the actor is the session
// of the request (null for a guest, which the use case turns into 401).
export async function handleCurator<T>(
  request: Request,
  options: { successStatus: number; run: CuratorRun<T> },
): Promise<Response> {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return json(403, { error: "forbidden_origin" });
  }

  try {
    const actor = await getIdentityProvider().getActor(request.headers);
    const body =
      request.method === "DELETE" ? { ok: true as const, value: {} } : await readBody(request);

    if (!body.ok) {
      // The body limit also protects the guest route from a large payload.
      return body.response;
    }

    return respond(await options.run(actor, body.value, getCatalogDeps()), options.successStatus);
  } catch (error) {
    logFailure("Curator request", error);

    return json(503, { error: "unavailable" });
  }
}
