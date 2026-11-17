// Typed contract of the operator command `npm run ops:curator` (D-T7). Shared by
// the command, the Postgres adapter and the demo seed. Never imported by
// src/app: the web runtime has no krajozbior_owner connection.
import type { AuditErrorCode } from "@/lib/db/operations-audit";

import type { OrganizationKind, OrganizationStatus } from "../domain/organization";

export type OpsOutcome = "applied" | "noop" | "rejected";

export type OperationContext = Readonly<{ operator: string; reason: string }>;

export type GrantCuratorInput = OperationContext &
  Readonly<{
    orgSlug: string;
    email: string;
    /** Required only when the first `grant` creates the organization. */
    name?: string;
    kind?: OrganizationKind;
  }>;
export type RevokeCuratorInput = OperationContext & Readonly<{ orgSlug: string; email: string }>;
export type SetOrganizationStatusInput = OperationContext &
  Readonly<{ orgSlug: string; status: OrganizationStatus }>;

// Never carries an e-mail address: the JSON on stdout shows identifiers only.
export type OpsCuratorResult = Readonly<{
  outcome: OpsOutcome;
  code?: AuditErrorCode;
  auditId?: string;
  organizationId?: string;
  organizationSlug: string;
  organizationCreated?: boolean;
  userId?: string;
  status?: OrganizationStatus;
}>;

export type OpsCuratorGateway = Readonly<{
  grantCurator(input: GrantCuratorInput): Promise<OpsCuratorResult>;
  revokeCurator(input: RevokeCuratorInput): Promise<OpsCuratorResult>;
  setOrganizationStatus(input: SetOrganizationStatusInput): Promise<OpsCuratorResult>;
}>;
