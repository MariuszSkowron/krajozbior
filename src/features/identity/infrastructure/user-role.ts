import "server-only";

import { Client, type ClientBase } from "pg";

import { writeAuditEntry } from "@/lib/db/operations-audit";

import type { Role } from "../domain/actor";

// krajozbior_auth, the identity adapter's role, may insert an account only
// without the `role` column (the database default `user` applies) and may never
// update it (migration Migration20261116120100_auth_schema). A role other than
// `user` is therefore set by a different connection: krajozbior_ops
// (DATABASE_OPS_URL), from an operator script (`npm run auth:create-admin`, the
// demo seed) and never from the web application (D-20, D-21).
//
// krajozbior_ops does not read `auth.users`: it finds the account with
// `ops_find_user` and changes the role with `ops_set_user_role`. The database
// refuses a role change (and an insert with a role other than `user`) unless
// the same transaction holds a matching `set_user_role` entry in
// `operations_audit`, so every assignment writes the entry first (migration
// Migration20261118120000_operations_audit_ops_role).
export type RoleAssignment = Readonly<{ operator: string; reason: string }>;

export type RoleAssignResult = Readonly<{
  outcome: "applied" | "noop" | "rejected";
  /** Set for `applied` and `rejected`; a `noop` leaves no entry. */
  auditId?: string;
}>;

export type RoleAssigner = (
  email: string,
  role: Role,
  assignment: RoleAssignment,
) => Promise<RoleAssignResult>;

/**
 * Sets the role of the account with this e-mail, as krajozbior_auth would try
 * to: a plain UPDATE. Kept for the test that proves the identity role cannot.
 */
export async function setUserRole(
  client: Pick<ClientBase, "query">,
  email: string,
  role: Role,
): Promise<boolean> {
  const result = await client.query(
    `update auth.users set role = $2, updated_at = now() where email = $1`,
    [email.trim().toLowerCase(), role],
  );

  return (result.rowCount ?? 0) > 0;
}

type RoleRow = { user_id: string; role: Role };

/**
 * A role assigner that connects to `connectionString` (krajozbior_ops) per
 * call. One transaction: find the account, write the `set_user_role` entry
 * (`before` and `after` hold only the role, never the e-mail), then change the
 * role. The same role again is a `noop` without an entry; an unknown e-mail
 * leaves a `rejected` entry.
 */
export function opsRoleAssigner(connectionString: string): RoleAssigner {
  return async (email, role, { operator, reason }) => {
    const client = new Client({ connectionString });

    await client.connect();
    try {
      await client.query("begin");

      const found = await client.query<RoleRow>(
        `select user_id, role from public.ops_find_user($1)`,
        [email],
      );
      const account = found.rows[0];
      let result: RoleAssignResult;

      if (account === undefined) {
        const auditId = await writeAuditEntry(client, {
          operation: "set_user_role",
          operator,
          reason,
          subjectUserId: null,
          organizationId: null,
          before: null,
          after: { role },
          outcome: "rejected",
          code: "user_not_found",
        });

        result = { outcome: "rejected", auditId };
      } else if (account.role === role) {
        result = { outcome: "noop" };
      } else {
        const auditId = await writeAuditEntry(client, {
          operation: "set_user_role",
          operator,
          reason,
          subjectUserId: account.user_id,
          organizationId: null,
          before: { role: account.role },
          after: { role },
          outcome: "applied",
          code: null,
        });

        await client.query(`select public.ops_set_user_role($1, $2)`, [account.user_id, role]);
        result = { outcome: "applied", auditId };
      }

      await client.query("commit");

      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  };
}
