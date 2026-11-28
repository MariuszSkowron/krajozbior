import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// X3 (audit P-09): a permanent catalog guard for the write gate of the curator panel.
let db: ScratchDatabase;

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

type FunctionRow = { name: string; src: string; owner: string };

// `pg_get_functiondef` returns the whole definition: the text body (`prosrc`) and also a body in
// the SQL standard (`begin atomic ... end`, PostgreSQL 14+), whose `prosrc` is empty.
const ownerFunctionsSql = `select p.proname as name, pg_catalog.pg_get_functiondef(p.oid) as src,
         pg_get_userbyid(p.proowner) as owner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema') and p.prosecdef
   order by 1`;
const writesGatedTable =
  /\b(insert\s+into|update|delete\s+from|truncate(\s+table)?|merge\s+into)\s+(only\s+)?("?public"?\.)?"?(organizations|organization_members|operations_audit|curator_applications)\b/i;

describe("the write gate of the curator panel and the owner functions (X3)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_curator_gate_owner");
    await db.migrate();
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("lets only the known owner functions write the gated tables or read the panel variable", async () => {
    // The variable `krajozbior.curator_panel_write` can be set by krajozbior_app itself, so inside ANY
    // owner function that writes these tables the gated policies would hold. This guard stops a future
    // function from inheriting that power without a review: extend the lists below only with it.
    const rows = await admin$<FunctionRow>(ownerFunctionsSql);

    expect(
      rows
        .filter((row) => writesGatedTable.test(row.src))
        .map((row) => row.name)
        .sort(),
    ).toEqual([
      "app_admin_decide_curator_application",
      "app_admin_revoke_curator",
      // The trigger of account deletion: writes `delete_account` to the audit with its own policy
      // (operations_audit_account_deletion_insert), independent of the variable; no role may run it.
      "auth_users_audit_deletion",
    ]);
    expect(
      rows
        .filter((row) => row.src.includes("curator_panel_write"))
        .map((row) => row.name)
        .sort(),
    ).toEqual(["app_admin_decide_curator_application", "app_admin_revoke_curator"]);
    expect(rows.every((row) => row.owner === "krajozbior_owner")).toBe(true);

    // The policies that use the variable: exactly these five, all only for the owner role.
    const policies = await admin$<{ policy: string; roles: string }>(
      `select tablename || '.' || policyname as policy, roles::text as roles from pg_policies
        where coalesce(qual, '') || coalesce(with_check, '') like '%curator_panel_write%'`,
    );

    expect(policies.map((row) => row.policy).sort()).toEqual(
      [
        "curator_applications.curator_applications_panel_update",
        "operations_audit.operations_audit_panel_insert",
        "organization_members.organization_members_panel_delete",
        "organization_members.organization_members_panel_insert",
        "organizations.organizations_panel_insert",
      ].sort(),
    );
    expect(new Set(policies.map((row) => row.roles))).toEqual(new Set(["{krajozbior_owner}"]));
  });

  // Proof that the guard turns red: canary functions (a text body and a `begin atomic` body) are
  // created in a transaction that is rolled back, and the same query and filter must find them.
  it("detects a new security definer function that writes a gated table (canary)", async () => {
    await withClient(db.adminUrl, async (client) => {
      await client.query("begin");
      try {
        await client.query(`create function public.zz_canary_plpgsql() returns void
          language plpgsql security definer as $$
          begin
            insert into public.organization_members (organization_id, user_id)
              select organization_id, user_id from public.organization_members where false;
          end $$`);
        await client.query(`create function public.zz_canary_atomic() returns void
          language sql security definer
          begin atomic
            delete from public.organization_members where false;
          end`);
        await client.query(`create function public.zz_canary_reader() returns text
          language plpgsql security definer as $$
          begin return current_setting('krajozbior.curator_panel_write', true); end $$`);

        const rows = (await client.query(ownerFunctionsSql)).rows as FunctionRow[];

        expect(
          rows
            .filter((row) => writesGatedTable.test(row.src))
            .map((row) => row.name)
            .filter((name) => name.startsWith("zz_canary"))
            .sort(),
        ).toEqual(["zz_canary_atomic", "zz_canary_plpgsql"]);
        expect(
          rows.filter((row) => row.src.includes("curator_panel_write")).map((row) => row.name),
        ).toContain("zz_canary_reader");
      } finally {
        await client.query("rollback");
      }
    });

    expect(
      (await admin$<FunctionRow>(ownerFunctionsSql)).some((row) =>
        row.name.startsWith("zz_canary"),
      ),
    ).toBe(false);
  });
});
