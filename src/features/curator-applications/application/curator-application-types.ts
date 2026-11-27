import type { ActionRateLimiter } from "@/features/identity/domain/action-rate-limit";
import type { OrganizationKind } from "@/features/organizations/domain/organization";
import type { ContextActor, TransactionContext } from "@/lib/db/user-context";

import type { CuratorApplicationInput } from "../domain/application-form";
import type { ApplicationScreenState } from "../domain/application-state";
import type { DecisionInput } from "../domain/decision";

export type ApplicationStatus = "pending" | "approved" | "rejected";

// What the applicant sees of an application. No account id: the applicant is always the actor.
export type MyCuratorApplication = Readonly<{
  id: string;
  organizationName: string;
  organizationKind: OrganizationKind;
  applicantRole: string;
  contact: string;
  websiteUrl: string | null;
  status: ApplicationStatus;
  createdAt: Date;
  rejectionReason: string | null;
  /** Name of the organization of an approved application, while the applicant can still see it. */
  organizationNameCurrent: string | null;
  /** The membership created by the approval still exists. */
  isMember: boolean;
  /** The organization is approved (a suspended one has no panel). */
  organizationApproved: boolean;
}>;

export type MyCuratorApplicationView = Readonly<{
  application: MyCuratorApplication | null;
  state: ApplicationScreenState;
}>;

// What the administrator sees of an application (from `app_admin_curator_applications`): explicit
// columns, the e-mail of the account for the check of the institution's domain (E10 Q3).
export type AdminCuratorApplication = Readonly<{
  id: string;
  organizationName: string;
  organizationKind: OrganizationKind;
  applicantRole: string;
  contact: string;
  websiteUrl: string | null;
  applicantEmail: string;
  status: ApplicationStatus;
  createdAt: Date;
  decidedAt: Date | null;
  rejectionReason: string | null;
  organizationId: string | null;
  organizationNameCurrent: string | null;
  /** True only for the newest approved application of the pair (person, organization). */
  applicantIsMember: boolean;
}>;

export type SubmitResult =
  | Readonly<{ status: "created"; id: string }>
  | Readonly<{ status: "pending_exists" }>
  | Readonly<{ status: "too_many_applications" }>;

export type WithdrawResult = "deleted" | "not_found" | "already_decided";

// The answer of `app_admin_decide_curator_application` and `app_admin_revoke_curator`: `refused`
// changed nothing in the database; `code` names why.
export type FunctionAnswer = Readonly<{
  outcome: "applied" | "refused";
  code: string | null;
  organizationId: string | null;
}>;

// All database access of the curator applications. Every method runs inside the context the use
// case opened (user context for the applicant, admin context for the administrator); no method
// takes an account id: the applicant is app_current_user_id() in SQL and the administrator's
// functions read the identity from the context themselves.
export interface CuratorApplicationsRepository {
  /** The newest application of the actor (by `created_at`) with the facts of its state. */
  findLatest(tx: TransactionContext): Promise<MyCuratorApplication | null>;
  /**
   * Inserts the application when the actor has no pending one and holds fewer than 20 rows.
   * A parallel second submit that gets past the check ends with 23505, which the use case maps.
   */
  insert(tx: TransactionContext, input: CuratorApplicationInput): Promise<SubmitResult>;
  /** Deletes the newest application when it is pending or rejected; see `WithdrawResult`. */
  withdrawLatest(tx: TransactionContext): Promise<WithdrawResult>;
  /** At most 200 applications of the status, from the function of the administrator. */
  listForAdmin(
    tx: TransactionContext,
    status: ApplicationStatus,
  ): Promise<readonly AdminCuratorApplication[]>;
  decide(
    tx: TransactionContext,
    applicationId: string,
    decision: DecisionInput,
  ): Promise<FunctionAnswer>;
  revoke(tx: TransactionContext, applicationId: string, reason: string): Promise<FunctionAnswer>;
}

export type CuratorApplicationsDeps = Readonly<{
  withUserContext: <T>(
    actor: ContextActor,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  withAdminContext: <T>(
    actor: ContextActor,
    sessionToken: string,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  limiter: ActionRateLimiter;
  repository: CuratorApplicationsRepository;
  /**
   * `CURATOR_PANEL_ENABLED`: while off, the use cases of the administrator answer `not_found`
   * before anything is read or written (defence in depth; the pages and routes of PR 3 check it
   * first). It does not protect against raw SQL: the functions of the database do not read it.
   */
  panelEnabled: () => boolean;
}>;

/** Why a decision or a revocation was refused although the request was well formed. */
export type ConflictCode =
  | "pending_exists"
  | "too_many_applications"
  | "already_decided"
  | "not_pending"
  | "slug_taken"
  | "organization_has_curators"
  | "kind_mismatch"
  | "admin_cannot_be_member"
  | "organization_not_found"
  | "not_member";

export type CuratorApplicationsOutcome<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "invalid"; fields?: readonly string[] }>
  | Readonly<{ status: "conflict"; code: ConflictCode }>
  | Readonly<{ status: "rate_limited"; retryAfterSeconds: number }>;
