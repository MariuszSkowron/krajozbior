import "server-only";

import { Client, type ClientBase } from "pg";

import type { Role } from "../domain/actor";

// starter_auth, the identity adapter's role, may insert an account only
// without the `role` column (the database default `user` applies) and may never
// update it (migration Migration20261116120100_auth_schema). A role other than
// `user` is therefore set by a different connection: starter_owner, the owner
// of the `auth` tables (DATABASE_MIGRATION_URL), from an operator script
// (`npm run auth:create-admin`, the demo seed) and never from the web
// application. The equivalent SQL, run as starter_owner:
//
//   update auth.users set role = 'admin', updated_at = now() where email = '<e-mail>';
export type RoleAssigner = (email: string, role: Role) => Promise<void>;

/** Sets the role of the account with this e-mail; false when there is none. */
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

/** A role assigner that connects to `connectionString` (starter_owner) per call. */
export function ownerRoleAssigner(connectionString: string): RoleAssigner {
  return async (email, role) => {
    const client = new Client({ connectionString });

    await client.connect();
    try {
      if (!(await setUserRole(client, email, role))) {
        throw new Error("No account with this e-mail to set the role of");
      }
    } finally {
      await client.end();
    }
  };
}
