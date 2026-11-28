import {
  AuthenticationRequiredError,
  requireActor,
  type Actor,
} from "@/features/identity/domain/actor";

import { REPORT_ACTION, reportSubmitLimit } from "../domain/limits";
import { validateSubmitInput } from "../domain/submit";
import type { MyReportsOutcome, ReportsDeps, SubmitOutcome } from "./report-types";

// Use cases of the explorer for reports of a problem with a place (P4b, PR B). The author is the
// actor from the session, never a parameter; the place comes from the address of the route. Which
// places may be reported, who may not (the organization of the place) and how many (limits) the
// database decides; this only sends and tells the answer.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function admit(actor: Actor | null): { actor: Actor } | { refusal: { status: "unauthenticated" } } {
  try {
    return { actor: requireActor(actor) };
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { refusal: { status: "unauthenticated" } };
    }
    throw error;
  }
}

/** Sends a report of a problem with a place. A guest gets `unauthenticated` before anything else. */
export async function submitPlaceReport(
  actor: Actor | null,
  placeId: string,
  body: Record<string, unknown>,
  deps: ReportsDeps,
): Promise<SubmitOutcome> {
  const admitted = admit(actor);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  // Counted before anything is checked, so a refusal reveals nothing (a series of tries is a series).
  const limit = await deps.limiter.reserve(REPORT_ACTION, admitted.actor.id, reportSubmitLimit);

  if (!limit.allowed) {
    return { status: "rate_limited", reason: "burst", retryAfterSeconds: limit.retryAfterSeconds };
  }

  if (!UUID.test(placeId)) {
    return { status: "not_found" };
  }

  const input = validateSubmitInput(body);

  if (!input.ok) {
    return { status: "invalid", errors: input.errors };
  }

  const result = await deps.withUserContext(admitted.actor, (tx) =>
    deps.repository.insertReport(tx, { placeId, ...input.value }),
  );

  switch (result.status) {
    case "ok":
      return { status: "ok", value: { id: result.id, organizationName: result.organizationName } };
    case "daily_limit":
      return { status: "rate_limited", reason: "daily" };
    case "open_limit":
      return { status: "rate_limited", reason: "open" };
    default:
      return result;
  }
}

/** The signed-in explorer's own reports ("Moje zgłoszenia"). */
export async function listMyReports(
  actor: Actor | null,
  deps: ReportsDeps,
): Promise<MyReportsOutcome> {
  const admitted = admit(actor);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  const items = await deps.withUserContext(admitted.actor, (tx) => deps.repository.listMine(tx));

  return { status: "ok", items };
}
