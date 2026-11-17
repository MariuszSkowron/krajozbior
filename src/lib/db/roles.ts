import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

import type { ClientBase } from "pg";

// Database roles of issue #21 (docs/data-isolation.md, section 3). Migrations
// grant table privileges; this module only creates the LOGIN roles, so it runs
// once per cluster and database from an administrator connection
// (`npm run db:roles`). Passwords come from the environment and are never
// logged or stored in the repository.
export const databaseRoles = [
  "starter_owner",
  "starter_app",
  "starter_auth",
  "starter_ops",
] as const;

export type DatabaseRole = (typeof databaseRoles)[number];

export type DatabaseRolePasswords = Record<DatabaseRole, string>;

export const ROLE_PASSWORD_MIN_LENGTH = 16;

export const rolePasswordVariables: Record<DatabaseRole, string> = {
  starter_owner: "STARTER_OWNER_DB_PASSWORD",
  starter_app: "STARTER_APP_DB_PASSWORD",
  starter_auth: "STARTER_AUTH_DB_PASSWORD",
  starter_ops: "STARTER_OPS_DB_PASSWORD",
};

// Printable ASCII only: PostgreSQL skips SASLprep for ASCII passwords, so the
// SCRAM verifier computed here matches what the server derives at login.
const printableAscii = /^[\x20-\x7e]*$/;

export function readRolePasswords(
  source: Record<string, string | undefined>,
): DatabaseRolePasswords {
  const invalid = databaseRoles
    .map((role) => rolePasswordVariables[role])
    .filter((name) => (source[name] ?? "").length < ROLE_PASSWORD_MIN_LENGTH);

  if (invalid.length > 0) {
    // Names only: the values are secrets.
    throw new Error(
      `Missing or too short (min. ${ROLE_PASSWORD_MIN_LENGTH} characters): ${invalid.join(", ")}`,
    );
  }

  const nonAscii = databaseRoles
    .map((role) => rolePasswordVariables[role])
    .filter((name) => !printableAscii.test(source[name] ?? ""));

  if (nonAscii.length > 0) {
    throw new Error(`Only printable ASCII characters are allowed: ${nonAscii.join(", ")}`);
  }

  return Object.fromEntries(
    databaseRoles.map((role) => [role, source[rolePasswordVariables[role]]]),
  ) as DatabaseRolePasswords;
}

const SCRAM_ITERATIONS = 4096;

// SCRAM-SHA-256 verifier in the format PostgreSQL stores (RFC 5802/7677). A
// password given in this form is stored as is, so the plain password never
// reaches the server and cannot end up in its log (issue #42).
export function scramSha256Verifier(password: string, salt = randomBytes(16)): string {
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, "sha256");
  const hmac = (key: Buffer, text: string) => createHmac("sha256", key).update(text).digest();
  const storedKey = createHash("sha256").update(hmac(salted, "Client Key")).digest();
  const serverKey = hmac(salted, "Server Key");

  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

type AdminClient = Pick<ClientBase, "query" | "escapeLiteral">;

// Idempotent: creates missing roles, resets attributes and passwords of
// existing ones, then prepares the current database for migrations run as
// starter_owner. Requires a superuser connection to that database.
export async function provisionDatabaseRoles(
  client: AdminClient,
  passwords: DatabaseRolePasswords,
): Promise<void> {
  // The SCRAM verifiers below are not passwords, but they must not land in
  // the server log either when log_statement covers DDL (issue #44).
  await client.query(`set log_statement = 'none'`);

  for (const role of databaseRoles) {
    await client.query(`do $$
      begin
        if not exists (select from pg_roles where rolname = '${role}') then
          create role ${role};
        end if;
      end $$`);
    // No role may create roles or databases, and NOINHERIT keeps a later
    // membership from silently widening what the role can do.
    await client.query(
      `alter role ${role} with login noinherit nocreaterole nocreatedb password ${client.escapeLiteral(scramSha256Verifier(passwords[role]))}`,
    );
  }

  // NOSUPERUSER/NOBYPASSRLS/NOREPLICATION are the defaults of CREATE ROLE;
  // a role that has them anyway was changed by hand and must not be used.
  const { rows } = await client.query<{ rolname: string }>(
    `select rolname from pg_roles
      where rolname = any($1) and (rolsuper or rolbypassrls or rolreplication)
      order by rolname`,
    [[...databaseRoles]],
  );

  if (rows.length > 0) {
    throw new Error(
      `Roles must not be superuser, bypass RLS or replicate: ${rows.map((row) => row.rolname).join(", ")}`,
    );
  }

  await client.query(`do $$
    begin
      execute format('grant create on database %I to starter_owner', current_database());
    end $$`);
  // PostgreSQL 15+ already denies PUBLIC this; revoking it explicitly, also
  // from the runtime roles, keeps them from creating objects on older or
  // hand-changed clusters. TEMPORARY stays: temp objects live only in the
  // session that creates them and cannot skip row policies.
  await client.query(
    `revoke create on schema public from public, starter_app, starter_auth, starter_ops`,
  );
  await client.query(`grant usage, create on schema public to starter_owner`);

  const { rows: creators } = await client.query<{ rolname: string }>(
    `select rolname from pg_roles
      where rolname = any($1) and has_schema_privilege(oid, 'public', 'CREATE')
      order by rolname`,
    [["starter_app", "starter_auth", "starter_ops"]],
  );

  if (creators.length > 0) {
    throw new Error(
      `Roles must not create objects in the public schema: ${creators.map((row) => row.rolname).join(", ")}`,
    );
  }
}
