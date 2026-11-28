import { isUuid } from "@/features/catalog/domain/uuid";
import {
  AuthenticationRequiredError,
  ForbiddenError,
  requireRole,
  type Actor,
  type Role,
} from "@/features/identity/domain/actor";
import type { ActorSession } from "@/features/identity/domain/identity-provider";
import { ORGANIZATION_NAME_MESSAGE } from "@/features/organizations/domain/organization";

import { validateCuratorApplicationInput } from "../domain/application-form";
import { applicationScreenState } from "../domain/application-state";
import { revocationReasonSchema, validateDecisionInput } from "../domain/decision";
import {
  CURATOR_APPLICATION_APPROVE_ACTION,
  CURATOR_APPLICATION_DECIDE_ACTION,
  CURATOR_APPLICATION_SUBMIT_ACTION,
  CURATOR_APPLICATION_WITHDRAW_ACTION,
  curatorApplicationApproveLimit,
  curatorApplicationDecideLimit,
  curatorApplicationSubmitLimit,
  curatorApplicationWithdrawLimit,
} from "../domain/limits";
import type {
  AdminCuratorApplication,
  ApplicationStatus,
  ConflictCode,
  CuratorApplicationsDeps,
  CuratorApplicationsOutcome,
  FunctionAnswer,
  MyCuratorApplicationView,
} from "./curator-application-types";

// Curator applications (spec "Rola kuratora", P7/P8). Every use case checks the role first and
// only then opens the database context; none takes an account id: the applicant is the actor of
// the session, and the administrator's functions read the identity from the context. The
// application writes its own row through row security; every decision about someone else's
// application is a function of the database that also checks, in the database, that the
// caller is an administrator with a live session (`app_require_live_admin`). A plain account never
// reaches those functions: the role check here, the role check there.

type Refusal = Exclude<CuratorApplicationsOutcome<never>, { status: "ok" }>;

const UNAUTHENTICATED: Refusal = { status: "unauthenticated" };
const NOT_FOUND: Refusal = { status: "not_found" };

function refuseRole(actor: Actor | null, role: Role): { actor: Actor } | { refusal: Refusal } {
  try {
    return { actor: requireRole(actor, role) };
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { refusal: UNAUTHENTICATED };
    }
    if (error instanceof ForbiddenError) {
      return { refusal: { status: "forbidden" } };
    }
    throw error;
  }
}

// Only the SQLSTATE of a database error is read, never its message (it can repeat user values).
function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;

  return typeof code === "string" ? code : undefined;
}

async function reserve(
  deps: CuratorApplicationsDeps,
  action: string,
  actorId: string,
  limit: Parameters<CuratorApplicationsDeps["limiter"]["reserve"]>[2],
): Promise<Refusal | null> {
  const decision = await deps.limiter.reserve(action, actorId, limit);

  return decision.allowed
    ? null
    : { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds };
}

const CONFLICT_CODES: readonly ConflictCode[] = [
  "not_pending",
  "slug_taken",
  "organization_exists",
  "kind_mismatch",
  "admin_cannot_be_member",
  "organization_not_found",
  "not_member",
];

// Maps the answer of a function of the administrator. A code this layer does not know is a bug of
// the migration or of this file, not a refusal of the user: it must not pass as one.
function fromFunctionAnswer(answer: FunctionAnswer): CuratorApplicationsOutcome<{
  organizationId: string | null;
}> {
  if (answer.outcome === "applied") {
    return { status: "ok", value: { organizationId: answer.organizationId } };
  }
  if (answer.code === "not_found") {
    return NOT_FOUND;
  }

  const code = CONFLICT_CODES.find((known) => known === answer.code);

  if (code === undefined) {
    throw new Error("Unexpected answer of a curator application function");
  }

  return { status: "conflict", code };
}

// The functions of the administrator refuse without a live session with 42501 and the fixed text
// below (`app_require_live_admin`), and a malformed argument with 22023 (the use case validated it,
// so this is a late race such as a deleted role). Another 42501 (a policy inside a function) is a
// bug of the migration, not a signed-out administrator: it goes on as a server error. The fixed
// text holds no user value, so comparing it is safe.
const LIVE_ADMIN_REFUSAL = "a live administrator session is required";

function isLiveAdminRefusal(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;

  return typeof message === "string" && message.includes(LIVE_ADMIN_REFUSAL);
}

function fromAdminDatabaseError(error: unknown): Refusal {
  const state = sqlState(error);

  if (state === "42501" && isLiveAdminRefusal(error)) {
    return UNAUTHENTICATED;
  }
  if (state === "22023") {
    return { status: "invalid" };
  }

  throw error;
}

/** The newest application of the signed-in explorer and the state the screen shows. */
export async function getMyCuratorApplication(
  actor: Actor | null,
  deps: CuratorApplicationsDeps,
): Promise<CuratorApplicationsOutcome<MyCuratorApplicationView>> {
  const admitted = refuseRole(actor, "user");

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  const application = await deps.withUserContext(admitted.actor, (tx) =>
    deps.repository.findLatest(tx),
  );

  return {
    status: "ok",
    value: {
      application,
      state: applicationScreenState(
        application === null
          ? null
          : {
              status: application.status,
              isMember: application.isMember,
              organizationApproved: application.organizationApproved,
            },
      ),
    },
  };
}

/** P7: the explorer sends an application. Only `user`; an administrator does not apply. */
export async function submitCuratorApplication(
  actor: Actor | null,
  body: unknown,
  deps: CuratorApplicationsDeps,
): Promise<CuratorApplicationsOutcome<{ id: string }>> {
  const admitted = refuseRole(actor, "user");

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  const input = validateCuratorApplicationInput(body);

  if (!input.ok) {
    return {
      status: "invalid",
      fields: input.fields,
      ...(input.fields.includes("organizationName") ? { message: ORGANIZATION_NAME_MESSAGE } : {}),
    };
  }

  const limited = await reserve(
    deps,
    CURATOR_APPLICATION_SUBMIT_ACTION,
    admitted.actor.id,
    curatorApplicationSubmitLimit,
  );

  if (limited !== null) {
    return limited;
  }

  try {
    const result = await deps.withUserContext(admitted.actor, (tx) =>
      deps.repository.insert(tx, input.value),
    );

    return result.status === "created"
      ? { status: "ok", value: { id: result.id } }
      : { status: "conflict", code: result.status };
  } catch (error) {
    // Two submits at once: the unique index of the pending application (23505) or the
    // restrictive policy of the limit of 20 (42501) won the race against the check.
    if (sqlState(error) === "23505") {
      return { status: "conflict", code: "pending_exists" };
    }
    if (sqlState(error) === "42501") {
      return { status: "conflict", code: "too_many_applications" };
    }

    throw error;
  }
}

/** Withdraws a pending application or removes a rejected one (the newest of the account). */
export async function withdrawCuratorApplication(
  actor: Actor | null,
  deps: CuratorApplicationsDeps,
): Promise<CuratorApplicationsOutcome<null>> {
  const admitted = refuseRole(actor, "user");

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  const limited = await reserve(
    deps,
    CURATOR_APPLICATION_WITHDRAW_ACTION,
    admitted.actor.id,
    curatorApplicationWithdrawLimit,
  );

  if (limited !== null) {
    return limited;
  }

  const result = await deps.withUserContext(admitted.actor, (tx) =>
    deps.repository.withdrawLatest(tx),
  );

  if (result === "not_found") {
    return NOT_FOUND;
  }

  return result === "already_decided"
    ? { status: "conflict", code: "already_decided" }
    : { status: "ok", value: null };
}

function refuseAdmin(
  session: ActorSession | null,
  deps: CuratorApplicationsDeps,
): { session: ActorSession } | { refusal: Refusal } {
  // The panel is off: nothing is read or written, and nothing says that it exists.
  if (!deps.panelEnabled()) {
    return { refusal: NOT_FOUND };
  }

  if (session === null) {
    return { refusal: UNAUTHENTICATED };
  }

  const admitted = refuseRole(session.actor, "admin");

  return "refusal" in admitted ? admitted : { session };
}

/** The applications of one status for the administrator (at most 200). */
export async function listCuratorApplications(
  session: ActorSession | null,
  status: unknown,
  deps: CuratorApplicationsDeps,
): Promise<CuratorApplicationsOutcome<readonly AdminCuratorApplication[]>> {
  const admitted = refuseAdmin(session, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }
  if (status !== "pending" && status !== "approved" && status !== "rejected") {
    return { status: "invalid" };
  }

  const wanted: ApplicationStatus = status;

  try {
    const value = await deps.withAdminContext(
      admitted.session.actor,
      admitted.session.sessionToken,
      (tx) => deps.repository.listForAdmin(tx, wanted),
    );

    return { status: "ok", value };
  } catch (error) {
    return fromAdminDatabaseError(error);
  }
}

/** P7: the administrator approves (new or existing organization) or rejects with a reason. */
export async function decideCuratorApplication(
  session: ActorSession | null,
  applicationId: string,
  body: unknown,
  deps: CuratorApplicationsDeps,
): Promise<CuratorApplicationsOutcome<{ organizationId: string | null }>> {
  const admitted = refuseAdmin(session, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }
  if (!isUuid(applicationId)) {
    return NOT_FOUND;
  }

  const decision = validateDecisionInput(body);

  if (!decision.ok) {
    return { status: "invalid" };
  }

  const { actor, sessionToken } = admitted.session;

  // The decision limit (20 per hour) goes first: a refusal by it must not spend a slot of the
  // approval limit (10 per 24 hours), which only an approval that is allowed through may use.
  // The reverse (approval refused after a decision slot was spent) costs a slot that renews within
  // the hour; the limiter has no way to take a slot back.
  const limited = await reserve(
    deps,
    CURATOR_APPLICATION_DECIDE_ACTION,
    actor.id,
    curatorApplicationDecideLimit,
  );

  if (limited !== null) {
    return limited;
  }
  if (decision.value.decision === "approve") {
    const approvalLimited = await reserve(
      deps,
      CURATOR_APPLICATION_APPROVE_ACTION,
      actor.id,
      curatorApplicationApproveLimit,
    );

    if (approvalLimited !== null) {
      return approvalLimited;
    }
  }

  try {
    const answer = await deps.withAdminContext(actor, sessionToken, (tx) =>
      deps.repository.decide(tx, applicationId, decision.value),
    );

    return fromFunctionAnswer(answer);
  } catch (error) {
    return fromAdminDatabaseError(error);
  }
}

/** P8: the administrator takes the curator role through an approved application. */
export async function revokeCuratorRole(
  session: ActorSession | null,
  applicationId: string,
  body: unknown,
  deps: CuratorApplicationsDeps,
): Promise<CuratorApplicationsOutcome<{ organizationId: string | null }>> {
  const admitted = refuseAdmin(session, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }
  if (!isUuid(applicationId)) {
    return NOT_FOUND;
  }

  const reason = revocationReasonSchema.safeParse(
    typeof body === "object" && body !== null ? (body as { reason?: unknown }).reason : undefined,
  );

  if (!reason.success) {
    return { status: "invalid" };
  }

  const { actor, sessionToken } = admitted.session;
  const limited = await reserve(
    deps,
    CURATOR_APPLICATION_DECIDE_ACTION,
    actor.id,
    curatorApplicationDecideLimit,
  );

  if (limited !== null) {
    return limited;
  }

  try {
    const answer = await deps.withAdminContext(actor, sessionToken, (tx) =>
      deps.repository.revoke(tx, applicationId, reason.data),
    );

    return fromFunctionAnswer(answer);
  } catch (error) {
    return fromAdminDatabaseError(error);
  }
}
