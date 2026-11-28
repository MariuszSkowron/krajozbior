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
    const rows = await admin$<{ name: string; src: string; owner: string }>(
      `select p.proname as name, p.prosrc as src, pg_get_userbyid(p.proowner) as owner
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname not in ('pg_catalog', 'information_schema') and p.prosecdef
        order by 1`,
    );
    const writesGatedTable =
      /\b(insert\s+into|update|delete\s+from|truncate(\s+table)?|merge\s+into)\s+(only\s+)?("?public"?\.)?"?(organizations|organization_members|operations_audit|curator_applications)\b/i;

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
});
