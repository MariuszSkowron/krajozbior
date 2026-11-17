import type { ClientBase } from "pg";

// Catalog guard for private tables (issue #21, docs/data-isolation.md test 1).
// Every issue that adds a PRIV or CUR table runs it on that table in its own
// integration test; an empty result means the table is safe to ship. Run it
// from the superuser connection of the scratch database: it reads the catalog
// only, it does not prove access (that needs LOGIN connections of the roles).
export async function findRowLevelSecurityGaps(
  client: Pick<ClientBase, "query">,
  tables: readonly string[],
): Promise<string[]> {
  const gaps: string[] = [];

  for (const table of tables) {
    const { rows } = await client.query<{
      enabled: boolean;
      forced: boolean;
      owner: string;
      policies: number;
    }>(
      `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
              pg_get_userbyid(c.relowner) as owner,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c
        where c.oid = to_regclass($1)`,
      [table],
    );
    const found = rows[0];

    if (found === undefined) {
      gaps.push(`${table}: table does not exist`);
      continue;
    }
    if (!found.enabled) gaps.push(`${table}: row level security is not enabled`);
    if (!found.forced) gaps.push(`${table}: row level security is not forced`);
    if (found.policies === 0) gaps.push(`${table}: no policies`);
    if (found.owner !== "starter_owner") gaps.push(`${table}: owned by ${found.owner}`);
  }

  return gaps;
}

// The application role must never be able to skip the policies above.
export async function findApplicationRoleGaps(
  client: Pick<ClientBase, "query">,
): Promise<string[]> {
  const { rows } = await client.query<{ gap: string }>(
    `select 'starter_app is superuser' as gap from pg_roles where rolname = 'starter_app' and rolsuper
     union all
     select 'starter_app bypasses RLS' from pg_roles where rolname = 'starter_app' and rolbypassrls
     union all
     select 'starter_app owns ' || c.oid::regclass::text
       from pg_class c where c.relowner = (select oid from pg_roles where rolname = 'starter_app')
     union all
     select 'starter_app is a member of ' || pg_get_userbyid(m.roleid)
       from pg_auth_members m where m.member = (select oid from pg_roles where rolname = 'starter_app')`,
  );

  return rows.map((row) => row.gap);
}
