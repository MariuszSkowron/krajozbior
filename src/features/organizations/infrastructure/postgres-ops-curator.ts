import "server-only";

import { Client } from "pg";

import type { AuditErrorCode, AuditOperation } from "@/lib/db/operations-audit";

import type {
  GrantCuratorInput,
  OpsCuratorGateway,
  OpsCuratorResult,
  RevokeCuratorInput,
  SetOrganizationStatusInput,
} from "../application/ops-curator-types";
import type { OpsCuratorConnection } from "../application/ops-curator-command";
import {
  canAddMember,
  isOrganizationKind,
  type OrganizationKind,
  type OrganizationStatus,
} from "../domain/organization";

// The operator command as SQL, on one connection as krajozbior_owner (D-T7):
// it must read auth.users by e-mail, which krajozbior_ops cannot. The tables
// have FORCE row security, so the owner works through the `to krajozbior_owner`
// policies of Migration20261117130000. Each command is one transaction:
// the change and its audit entry commit together, and a refusal commits only
// its `rejected` entry. A `noop` writes nothing.

export type QueryClient = Readonly<{
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}>;

type OrganizationRow = { id: string; kind: OrganizationKind; status: OrganizationStatus };

type Audit = Readonly<{
  operation: AuditOperation;
  operator: string;
  reason: string;
  subjectUserId: string | null;
  organizationId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  outcome: "applied" | "rejected";
  code: AuditErrorCode | null;
}>;

async function writeAudit(client: QueryClient, entry: Audit): Promise<string> {
  const { rows } = await client.query(
    `insert into public.operations_audit
       (operation, operator_label, subject_user_id, organization_id, outcome,
        before_state, after_state, reason, error_code)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
     returning id`,
    [
      entry.operation,
      entry.operator,
      entry.subjectUserId,
      entry.organizationId,
      entry.outcome,
      entry.before === null ? null : JSON.stringify(entry.before),
      entry.after === null ? null : JSON.stringify(entry.after),
      entry.reason,
      entry.code,
    ],
  );

  return rows[0].id as string;
}

async function lockOrganization(
  client: QueryClient,
  slug: string,
): Promise<OrganizationRow | null> {
  const { rows } = await client.query(
    `select id, kind, status from public.organizations where slug = $1 for update`,
    [slug],
  );
  const row = rows[0];

  if (row === undefined) {
    return null;
  }
  if (!isOrganizationKind(row.kind)) {
    throw new Error("Unexpected organization kind in the database");
  }

  return { id: row.id as string, kind: row.kind, status: row.status as OrganizationStatus };
}

async function findUserId(client: QueryClient, email: string): Promise<string | null> {
  const { rows } = await client.query(`select id from auth.users where email = $1`, [email]);

  return (rows[0]?.id as string | undefined) ?? null;
}

async function reject(
  client: QueryClient,
  operation: AuditOperation,
  input: { operator: string; reason: string; orgSlug: string },
  code: AuditErrorCode,
  ids: { subjectUserId?: string | null; organizationId?: string | null },
): Promise<OpsCuratorResult> {
  const auditId = await writeAudit(client, {
    operation,
    operator: input.operator,
    reason: input.reason,
    subjectUserId: ids.subjectUserId ?? null,
    organizationId: ids.organizationId ?? null,
    before: null,
    // The slug is public; the e-mail is never stored.
    after: { organizationSlug: input.orgSlug },
    outcome: "rejected",
    code,
  });

  return {
    outcome: "rejected",
    code,
    auditId,
    organizationSlug: input.orgSlug,
    ...(ids.organizationId ? { organizationId: ids.organizationId } : {}),
    ...(ids.subjectUserId ? { userId: ids.subjectUserId } : {}),
  };
}

async function grantCurator(
  client: QueryClient,
  input: GrantCuratorInput,
): Promise<OpsCuratorResult> {
  const userId = await findUserId(client, input.email);

  if (userId === null) {
    return reject(client, "grant_curator", input, "user_not_found", {});
  }

  let organization = await lockOrganization(client, input.orgSlug);
  let created = false;

  if (organization === null) {
    if (input.name === undefined || input.kind === undefined) {
      return reject(client, "grant_curator", input, "organization_details_required", {
        subjectUserId: userId,
      });
    }

    // Two parallel first `grant`s for one slug: the loser inserts nothing and
    // then reads the row of the winner (no unique violation).
    const inserted = await client.query(
      `insert into public.organizations (name, slug, kind, status)
       values ($1, $2, $3, 'approved') on conflict (slug) do nothing`,
      [input.name, input.orgSlug, input.kind],
    );

    created = (inserted.rowCount ?? 0) > 0;
    organization = await lockOrganization(client, input.orgSlug);
  }
  if (organization === null) {
    throw new Error("Organization vanished after insert");
  }
  if (input.kind !== undefined && input.kind !== organization.kind) {
    return reject(client, "grant_curator", input, "kind_mismatch", {
      subjectUserId: userId,
      organizationId: organization.id,
    });
  }

  const existing = await client.query(
    `select user_id from public.organization_members where organization_id = $1`,
    [organization.id],
  );

  if (existing.rows.some((row) => row.user_id === userId)) {
    return {
      outcome: "noop",
      organizationId: organization.id,
      organizationSlug: input.orgSlug,
      userId,
      status: organization.status,
    };
  }
  if (!canAddMember(organization.kind, existing.rows.length)) {
    return reject(client, "grant_curator", input, "person_member_limit", {
      subjectUserId: userId,
      organizationId: organization.id,
    });
  }

  await client.query(
    `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
    [organization.id, userId],
  );

  const auditId = await writeAudit(client, {
    operation: "grant_curator",
    operator: input.operator,
    reason: input.reason,
    subjectUserId: userId,
    organizationId: organization.id,
    before: { member: false },
    after: {
      member: true,
      organizationSlug: input.orgSlug,
      organizationKind: organization.kind,
      organizationCreated: created,
    },
    outcome: "applied",
    code: null,
  });

  return {
    outcome: "applied",
    auditId,
    organizationId: organization.id,
    organizationSlug: input.orgSlug,
    organizationCreated: created,
    userId,
    status: organization.status,
  };
}

async function revokeCurator(
  client: QueryClient,
  input: RevokeCuratorInput,
): Promise<OpsCuratorResult> {
  const userId = await findUserId(client, input.email);

  if (userId === null) {
    return reject(client, "revoke_curator", input, "user_not_found", {});
  }

  const organization = await lockOrganization(client, input.orgSlug);

  if (organization === null) {
    return reject(client, "revoke_curator", input, "organization_not_found", {
      subjectUserId: userId,
    });
  }

  const deleted = await client.query(
    `delete from public.organization_members where organization_id = $1 and user_id = $2`,
    [organization.id, userId],
  );

  if ((deleted.rowCount ?? 0) === 0) {
    return {
      outcome: "noop",
      organizationId: organization.id,
      organizationSlug: input.orgSlug,
      userId,
    };
  }

  const auditId = await writeAudit(client, {
    operation: "revoke_curator",
    operator: input.operator,
    reason: input.reason,
    subjectUserId: userId,
    organizationId: organization.id,
    before: { member: true, organizationSlug: input.orgSlug },
    after: { member: false },
    outcome: "applied",
    code: null,
  });

  return {
    outcome: "applied",
    auditId,
    organizationId: organization.id,
    organizationSlug: input.orgSlug,
    userId,
  };
}

async function setOrganizationStatus(
  client: QueryClient,
  input: SetOrganizationStatusInput,
): Promise<OpsCuratorResult> {
  const organization = await lockOrganization(client, input.orgSlug);

  if (organization === null) {
    return reject(client, "set_organization_status", input, "organization_not_found", {});
  }
  if (organization.status === input.status) {
    return {
      outcome: "noop",
      organizationId: organization.id,
      organizationSlug: input.orgSlug,
      status: organization.status,
    };
  }

  await client.query(`update public.organizations set status = $2 where id = $1`, [
    organization.id,
    input.status,
  ]);

  const auditId = await writeAudit(client, {
    operation: "set_organization_status",
    operator: input.operator,
    reason: input.reason,
    subjectUserId: null,
    organizationId: organization.id,
    before: { status: organization.status, organizationSlug: input.orgSlug },
    after: { status: input.status },
    outcome: "applied",
    code: null,
  });

  return {
    outcome: "applied",
    auditId,
    organizationId: organization.id,
    organizationSlug: input.orgSlug,
    status: input.status,
  };
}

async function inTransaction<T>(client: QueryClient, work: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    const result = await work();

    await client.query("commit");

    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

export function createOpsCuratorGateway(client: QueryClient): OpsCuratorGateway {
  return {
    grantCurator: (input) => inTransaction(client, () => grantCurator(client, input)),
    revokeCurator: (input) => inTransaction(client, () => revokeCurator(client, input)),
    setOrganizationStatus: (input) =>
      inTransaction(client, () => setOrganizationStatus(client, input)),
  };
}

// An operation waits at most this long for a row lock held by another
// transaction, and runs at most this long in total; either error (55P03,
// 57014) ends the command as an infrastructure failure (exit 1), nothing saved.
export const OPS_LOCK_TIMEOUT_MS = 5_000;
export const OPS_STATEMENT_TIMEOUT_MS = 30_000;

// One connection as krajozbior_owner (DATABASE_MIGRATION_URL).
export async function connectOpsCurator(connectionString: string): Promise<OpsCuratorConnection> {
  const client = new Client({
    connectionString,
    lock_timeout: OPS_LOCK_TIMEOUT_MS,
    statement_timeout: OPS_STATEMENT_TIMEOUT_MS,
  });

  await client.connect();

  return {
    gateway: createOpsCuratorGateway(client as unknown as QueryClient),
    close: () => client.end(),
  };
}
