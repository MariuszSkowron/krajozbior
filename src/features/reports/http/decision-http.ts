import "server-only";

import type { Actor } from "@/features/identity/domain/actor";
import { isSameOrigin } from "@/features/identity/domain/origin";
import { getIdentityProvider } from "@/features/identity/infrastructure";
import { logFailure } from "@/lib/log-failure";

import { decideReport } from "../application/curator-reports";
import type { ReportsDeps } from "../application/report-types";
import { DECISION_BODY_MAX_BYTES } from "../domain/report";
import { getReportsDeps } from "../infrastructure/reports-deps";

// The route of a curator's decision: origin check, bounded JSON body, the actor from the session
// and the mapping of the answer of the use case to a status. Rules live in the use case and in
// the database; nothing here decides who may do what. The answers never name the report's
// organization, author or deciding curator.

const HEADERS = { "Cache-Control": "private, no-store" };

const json = (status: number, body: unknown): Response =>
  Response.json(body, { status, headers: HEADERS });

type Body = { ok: true; value: Record<string, unknown> } | { ok: false; response: Response };

// Reads at most DECISION_BODY_MAX_BYTES; a bigger body is cut off, not buffered.
async function readBody(request: Request): Promise<Body> {
  if (Number(request.headers.get("content-length") ?? "0") > DECISION_BODY_MAX_BYTES) {
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

    if (size > DECISION_BODY_MAX_BYTES) {
      await reader.cancel();

      return { ok: false, response: json(413, { error: "payload_too_large" }) };
    }

    chunks.push(value);
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

const STALE_MESSAGE = "To zgłoszenie rozpatrzył już ktoś inny. Odśwież listę.";

type Dependencies = Readonly<{
  getActor: (headers: Headers) => Promise<Actor | null>;
  deps: () => ReportsDeps;
}>;

const defaults: Dependencies = {
  getActor: (headers) => getIdentityProvider().getActor(headers),
  deps: getReportsDeps,
};

export async function handleDecision(
  request: Request,
  reportId: string,
  dependencies: Dependencies = defaults,
): Promise<Response> {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return json(403, { error: "forbidden_origin" });
  }

  try {
    const actor = await dependencies.getActor(request.headers);
    const body = await readBody(request);

    if (!body.ok) {
      return body.response;
    }

    const outcome = await decideReport(actor, reportId, body.value, dependencies.deps());

    switch (outcome.status) {
      case "ok":
        return json(200, outcome.value);
      case "unauthenticated":
        return json(401, { error: "unauthenticated" });
      // The panel does not announce itself: no membership looks like a foreign report.
      case "forbidden":
      case "not_found":
        return json(404, { error: "not_found" });
      case "invalid":
        return json(422, { error: "invalid", fields: outcome.errors });
      case "conflict":
        return json(409, {
          error: "conflict",
          reason: outcome.reason,
          ...(outcome.reason === "stale_version" ? { message: STALE_MESSAGE } : {}),
        });
    }
  } catch (error) {
    logFailure("Report decision", error);

    return json(503, { error: "unavailable" });
  }
}
