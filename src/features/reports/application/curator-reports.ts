import {
  AuthenticationRequiredError,
  requireActor,
  type Actor,
} from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

import { CURATOR_WRITE_ACTION, curatorWriteLimit } from "@/features/catalog/domain/limits";

import { validateDecisionInput, type ReportQueueState } from "../domain/report";
import type { DecisionOutcome, ReportOutcome, ReportQueue, ReportsDeps } from "./report-types";

// Use cases of the curator for the queue of reports (P4b). The actor comes from the session,
// never from the caller. The caller's organization id is only a choice among the actor's own
// memberships; the database repeats the check (functions with `app_org_permission`).

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

// A caller without a membership of an approved organization is `forbidden` before anything is
// read; a chosen organization that is not theirs is `not_found`, like a missing one.
async function inOrganizationContext<T>(
  actor: Actor,
  organizationId: string,
  deps: ReportsDeps,
  work: (tx: TransactionContext) => Promise<ReportOutcome<T>>,
): Promise<ReportOutcome<T>> {
  return deps.withUserContext(actor, async (tx) => {
    const organizationIds = await deps.repository.permittedOrganizationIds(tx);

    if (organizationIds.length === 0) {
      return { status: "forbidden" } as const;
    }

    if (!UUID.test(organizationId) || !organizationIds.includes(organizationId)) {
      return { status: "not_found" } as const;
    }

    return work(tx);
  });
}

/** The number on the front page of the panel: all open reports of the organization. */
export async function countOpenReports(
  actor: Actor | null,
  organizationId: string,
  deps: ReportsDeps,
): Promise<ReportOutcome<number>> {
  const admitted = admit(actor);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  return inOrganizationContext(admitted.actor, organizationId, deps, async (tx) => ({
    status: "ok",
    value: await deps.repository.countOpen(tx, organizationId),
  }));
}

/** One list of the queue ("Do sprawdzenia" or "Rozpatrzone") with the count of all open reports. */
export async function getReportQueue(
  actor: Actor | null,
  organizationId: string,
  state: ReportQueueState,
  deps: ReportsDeps,
): Promise<ReportOutcome<ReportQueue>> {
  const admitted = admit(actor);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  return inOrganizationContext(admitted.actor, organizationId, deps, async (tx) => {
    const [items, openTotal] = await Promise.all([
      deps.repository.listQueue(tx, organizationId, state),
      deps.repository.countOpen(tx, organizationId),
    ]);

    return { status: "ok", value: { state, items, openTotal } } as const;
  });
}

/**
 * accept, reject (with a reason) or undo. Which report belongs to which organization is
 * decided by the database: a report of another organization and a missing one are the same
 * `not_found`.
 */
export async function decideReport(
  actor: Actor | null,
  reportId: string,
  body: Record<string, unknown>,
  deps: ReportsDeps,
): Promise<DecisionOutcome<{ version: number; status: "open" | "accepted" | "rejected" }>> {
  const admitted = admit(actor);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  // Counted before anything else is checked, like the other curator writes (a refusal reveals nothing).
  const limit = await deps.limiter.reserve(
    CURATOR_WRITE_ACTION,
    admitted.actor.id,
    curatorWriteLimit,
  );

  if (!limit.allowed) {
    return { status: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };
  }

  if (!UUID.test(reportId)) {
    return { status: "not_found" };
  }

  const input = validateDecisionInput(body);

  if (!input.ok) {
    return { status: "invalid", errors: input.errors };
  }

  const decision = input.value;

  return deps.withUserContext(admitted.actor, async (tx) => {
    // Without any membership the caller gets the same answer as for a foreign report.
    if ((await deps.repository.permittedOrganizationIds(tx)).length === 0) {
      return { status: "forbidden" } as const;
    }

    const result = await deps.repository.decide(tx, { reportId, ...decision });

    switch (result.status) {
      case "ok":
        return {
          status: "ok",
          value: {
            version: result.version,
            status:
              decision.action === "undo"
                ? "open"
                : decision.action === "accept"
                  ? "accepted"
                  : "rejected",
          },
        } as const;
      case "conflict":
        return { status: "conflict", reason: result.reason } as const;
      case "invalid":
        return { status: "invalid", errors: ["action"] } as const;
      case "not_found":
        return { status: "not_found" } as const;
    }
  });
}
