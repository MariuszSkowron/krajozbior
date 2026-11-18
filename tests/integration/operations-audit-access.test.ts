import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// D-20 pt 2 and D-21: the operations audit cannot be changed or switched off by
// the role that writes it (krajozbior_ops), and the role of an account changes
// only together with a `set_user_role` entry of the same transaction. Every
// claim goes through a real LOGIN connection of the role; the superuser only
// prepares data and reads the catalog.
const denied = { code: "42501" };
const refusedWithoutEntry = { code: "55000" };
const appendOnly = { code: "55000" };

let db: ScratchDatabase;

type Role = "krajozbior_app" | "krajozbior_auth" | "krajozbior_ops" | "krajozbior_owner";

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);
const as$ = (role: Role, sql: string, params: unknown[] = []) =>
  withClient(db.urls[role], (client) => client.query(sql, params));

async function newAccount(role: "user" | "admin" = "user") {
  const id = randomUUID();
  const email = `${id}@example.com`;

  // The superuser sets the role directly, before the triggers exist for the
  // purpose of the test: the account is created as `user` and then, when an
  // admin is needed, promoted with the same trail the product leaves.
  await admin$(`insert into auth.users (id, name, email) values ($1, 'x', $2)`, [id, email]);
  if (role === "admin") {
    await withClient(db.urls.krajozbior_ops, async (client) => {
      await client.query("begin");
      await writeEntry(client, id, "admin");
      await client.query(`select public.ops_set_user_role($1, 'admin')`, [id]);
      await client.query("commit");
    });
  }

  return { id, email };
}

const roleOf = async (id: string) =>
  (await admin$<{ role: string }>(`select role from auth.users where id = $1`, [id]))[0]!.role;

// The entry the role-change trigger looks for: applied, for this account, with
// the target role, in the current transaction (as krajozbior_ops).
const writeEntry = (client: Client, subjectId: string, role: string) =>
  client.query(
    `insert into public.operations_audit
       (operation, operator_label, subject_user_id, outcome, before_state, after_state, reason)
     values ('set_user_role', 'tester', $1, 'applied', null, $2::jsonb, 'Test')`,
    [subjectId, JSON.stringify({ role })],
  );
const setRole = (client: Client, id: string, role: string) =>
  client.query(`select public.ops_set_user_role($1, $2)`, [id, role]);
const auditCount = async () =>
  (await admin$<{ n: number }>(`select count(*)::int as n from public.operations_audit`))[0]!.n;

describe("operations audit: the writing role cannot change it", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_operations_audit");
    await db.migrate();
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("refuses krajozbior_ops every statement that would switch off or remove the protection", async () => {
    for (const statement of [
      `alter table public.operations_audit disable trigger operations_audit_append_only`,
      `alter table public.operations_audit disable trigger all`,
      `alter table public.operations_audit no force row level security`,
      `alter table public.operations_audit disable row level security`,
      `drop trigger operations_audit_append_only on public.operations_audit`,
      `drop table public.operations_audit`,
    ]) {
      await expect(as$("krajozbior_ops", statement), statement).rejects.toMatchObject(denied);
    }
  });

  it("refuses krajozbior_ops UPDATE, DELETE and TRUNCATE and leaves the entry unchanged", async () => {
    const [{ id }] = await admin$<{ id: string }>(
      `insert into public.operations_audit (operation, operator_label, outcome, reason)
       values ('grant_curator', 'seed', 'applied', 'powód') returning id`,
    );

    for (const statement of [
      `update public.operations_audit set reason = 'x' where id = $1`,
      `delete from public.operations_audit where id = $1`,
    ]) {
      await expect(as$("krajozbior_ops", statement, [id]), statement).rejects.toMatchObject(denied);
    }
    await expect(as$("krajozbior_ops", `truncate public.operations_audit`)).rejects.toMatchObject(
      denied,
    );
    expect(await admin$(`select reason from public.operations_audit where id = $1`, [id])).toEqual([
      { reason: "powód" },
    ]);
  });

  it("refuses krajozbior_app and krajozbior_auth any read or change of an entry", async () => {
    const [{ id }] = await admin$<{ id: string }>(
      `insert into public.operations_audit (operation, operator_label, outcome, reason)
       values ('grant_curator', 'seed', 'applied', 'powód') returning id`,
    );

    for (const role of ["krajozbior_app", "krajozbior_auth"] as const) {
      for (const statement of [
        `select reason from public.operations_audit where id = $1`,
        `update public.operations_audit set reason = 'x' where id = $1`,
        `delete from public.operations_audit where id = $1`,
      ]) {
        await expect(as$(role, statement, [id]), `${role}: ${statement}`).rejects.toMatchObject(
          denied,
        );
      }
      await expect(as$(role, `truncate public.operations_audit`), role).rejects.toMatchObject(
        denied,
      );
    }
    expect(await admin$(`select reason from public.operations_audit where id = $1`, [id])).toEqual([
      { reason: "powód" },
    ]);
  });

  it("does not let krajozbior_owner change or remove an entry through DML either", async () => {
    const [{ id }] = await admin$<{ id: string }>(
      `insert into public.operations_audit (operation, operator_label, outcome, reason)
       values ('grant_curator', 'seed', 'applied', 'powód') returning id`,
    );

    // FORCE RLS without an UPDATE/DELETE policy hides every row from the owner.
    expect(
      (
        await as$(
          "krajozbior_owner",
          `update public.operations_audit set reason = 'x' where id = $1`,
          [id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (await as$("krajozbior_owner", `delete from public.operations_audit where id = $1`, [id]))
        .rowCount,
    ).toBe(0);
    // TRUNCATE skips RLS; the statement trigger stops it.
    await expect(as$("krajozbior_owner", `truncate public.operations_audit`)).rejects.toMatchObject(
      appendOnly,
    );
    // Even the cluster superuser (which bypasses RLS) meets the append-only trigger.
    await expect(
      admin$(`update public.operations_audit set reason = 'x' where id = $1`, [id]),
    ).rejects.toMatchObject(appendOnly);
    await expect(
      admin$(`delete from public.operations_audit where id = $1`, [id]),
    ).rejects.toMatchObject(appendOnly);
    expect(await admin$(`select reason from public.operations_audit where id = $1`, [id])).toEqual([
      { reason: "powód" },
    ]);
  });

  it("lets the database, not the writer, set the time, the account and the transaction", async () => {
    const columns = ["id", "occurred_at", "recorded_by", "transaction_id"];
    const values: Record<string, string> = {
      id: `'${randomUUID()}'`,
      occurred_at: `'2001-01-01T00:00:00Z'`,
      recorded_by: `'someone-else'`,
      transaction_id: `'1'::xid8`,
    };

    for (const column of columns) {
      await expect(
        as$(
          "krajozbior_ops",
          `insert into public.operations_audit (operation, operator_label, outcome, reason, ${column})
           values ('grant_curator', 'tester', 'applied', 'powód', ${values[column]})`,
        ),
        column,
      ).rejects.toMatchObject(denied);
    }

    const transaction = await withClient(db.urls.krajozbior_ops, async (client) => {
      await client.query("begin");
      const inserted = await client.query<{ id: string }>(
        `insert into public.operations_audit (operation, operator_label, outcome, reason)
         values ('grant_curator', 'tester', 'applied', 'powód') returning id`,
      );
      const xid = await client.query<{ xid: string }>(`select pg_current_xact_id()::text as xid`);

      await client.query("commit");

      return { id: inserted.rows[0]!.id, xid: xid.rows[0]!.xid };
    });

    expect(
      await admin$(
        `select recorded_by, transaction_id::text as xid, occurred_at is not null as has_time
           from public.operations_audit where id = $1`,
        [transaction.id],
      ),
    ).toEqual([{ recorded_by: "krajozbior_ops", xid: transaction.xid, has_time: true }]);
  });

  it("gives exactly the intended privileges on the three tables and the functions", async () => {
    const [p] = await admin$<Record<string, boolean>>(
      `select
         has_column_privilege('krajozbior_ops', 'operations_audit', 'id', 'select') as audit_id_select,
         has_column_privilege('krajozbior_ops', 'operations_audit', 'reason', 'select') as audit_reason_select,
         has_column_privilege('krajozbior_ops', 'operations_audit', 'before_state', 'select') as audit_before_select,
         has_column_privilege('krajozbior_ops', 'operations_audit', 'reason', 'insert') as audit_reason_insert,
         has_column_privilege('krajozbior_ops', 'operations_audit', 'recorded_by', 'insert') as audit_recorded_insert,
         has_any_column_privilege('krajozbior_ops', 'operations_audit', 'update') as audit_update,
         has_table_privilege('krajozbior_ops', 'operations_audit', 'delete, truncate, references, trigger') as audit_other,
         has_column_privilege('krajozbior_ops', 'organizations', 'status', 'update') as org_status_update,
         has_column_privilege('krajozbior_ops', 'organizations', 'name', 'update') as org_name_update,
         has_column_privilege('krajozbior_ops', 'organizations', 'kind', 'update') as org_kind_update,
         has_table_privilege('krajozbior_ops', 'organizations', 'select, insert') as org_rw,
         has_table_privilege('krajozbior_ops', 'organizations', 'delete, truncate, references, trigger') as org_other,
         has_table_privilege('krajozbior_ops', 'organization_members', 'select, insert, delete') as mem_rw,
         has_table_privilege('krajozbior_ops', 'organization_members', 'update, truncate, references, trigger') as mem_other,
         has_any_column_privilege('krajozbior_ops', 'organization_members', 'update') as mem_update,
         has_any_column_privilege('krajozbior_app', 'operations_audit', 'select, insert, update') as app_audit,
         has_any_column_privilege('krajozbior_auth', 'operations_audit', 'select, insert, update') as auth_audit,
         has_any_column_privilege('krajozbior_app', 'organizations', 'insert, update') as app_org_write,
         has_any_column_privilege('krajozbior_auth', 'organizations', 'select, insert, update') as auth_org,
         has_any_column_privilege('krajozbior_auth', 'organization_members', 'select, insert, update') as auth_mem,
         has_function_privilege('krajozbior_ops', 'ops_find_user(text)', 'execute') as ops_find,
         has_function_privilege('krajozbior_ops', 'ops_set_user_role(uuid, text)', 'execute') as ops_set,
         has_function_privilege('krajozbior_ops', 'auth_users_require_role_audit()', 'execute') as ops_trigger_fn`,
    );

    expect(p).toEqual({
      audit_id_select: true,
      audit_reason_select: false,
      audit_before_select: false,
      audit_reason_insert: true,
      audit_recorded_insert: false,
      audit_update: false,
      audit_other: false,
      org_status_update: true,
      org_name_update: false,
      org_kind_update: false,
      org_rw: true,
      org_other: false,
      mem_rw: true,
      mem_other: false,
      mem_update: false,
      app_audit: false,
      auth_audit: false,
      app_org_write: false,
      auth_org: false,
      auth_mem: false,
      ops_find: true,
      ops_set: true,
      ops_trigger_fn: false,
    });

    for (const role of ["krajozbior_app", "krajozbior_auth", "public"]) {
      const [f] = await admin$<Record<string, boolean>>(
        `select has_function_privilege($1, 'ops_find_user(text)', 'execute') as find,
                has_function_privilege($1, 'ops_set_user_role(uuid, text)', 'execute') as setter,
                has_function_privilege($1, 'auth_users_require_role_audit()', 'execute') as trigger_fn`,
        [role],
      );

      expect(f, role).toEqual({ find: false, setter: false, trigger_fn: false });
    }
    await expect(as$("krajozbior_ops", `select * from auth.users`)).rejects.toMatchObject(denied);
    await expect(
      as$("krajozbior_ops", `select reason from public.operations_audit`),
    ).rejects.toMatchObject(denied);
  });

  it("refuses the functions to krajozbior_app and krajozbior_auth", async () => {
    for (const role of ["krajozbior_app", "krajozbior_auth"] as const) {
      await expect(
        as$(role, `select * from public.ops_find_user('a@example.com')`),
      ).rejects.toMatchObject(denied);
      await expect(
        as$(role, `select public.ops_set_user_role($1, 'admin')`, [randomUUID()]),
      ).rejects.toMatchObject(denied);
    }
  });

  it("bars krajozbior_owner from writing the audit, organizations and members (RLS, no write policies)", async () => {
    const [{ id: orgId }] = await admin$<{ id: string }>(
      `insert into public.organizations (name, slug, kind) values ('Seed', 'owner-seed', 'other') returning id`,
    );
    const { id: userId } = await newAccount();

    await admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [orgId, userId],
    );

    await expect(
      as$(
        "krajozbior_owner",
        `insert into public.operations_audit (operation, operator_label, outcome, reason)
         values ('grant_curator', 'x', 'applied', 'powód')`,
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      as$(
        "krajozbior_owner",
        `insert into public.organizations (name, slug, kind) values ('x', 'owner-new', 'other')`,
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      as$(
        "krajozbior_owner",
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [orgId, randomUUID()],
      ),
    ).rejects.toMatchObject(denied);

    // RLS hides the rows from UPDATE and DELETE: no error, zero rows, no change.
    const affected = async (sql: string, id: string) =>
      (await as$("krajozbior_owner", sql, [id])).rowCount;

    expect(await affected(`update public.organizations set name = 'x' where id = $1`, orgId)).toBe(
      0,
    );
    expect(await affected(`delete from public.organizations where id = $1`, orgId)).toBe(0);
    expect(
      await affected(
        `update public.organization_members set created_at = now() where user_id = $1`,
        userId,
      ),
    ).toBe(0);
    expect(
      await affected(`delete from public.organization_members where user_id = $1`, userId),
    ).toBe(0);
    expect(await admin$(`select name from public.organizations where id = $1`, [orgId])).toEqual([
      { name: "Seed" },
    ]);
    expect(
      await admin$(`select 1 from public.organization_members where user_id = $1`, [userId]),
    ).toHaveLength(1);
  });

  describe("ops_find_user", () => {
    it("finds an account by the exact e-mail, ignoring case and edge spaces, and nothing else", async () => {
      const { id, email } = await newAccount();
      const find = (value: string) =>
        as$("krajozbior_ops", `select user_id, role from public.ops_find_user($1)`, [value]).then(
          (result) => result.rows as { user_id: string; role: string }[],
        );

      expect(await find(email)).toEqual([{ user_id: id, role: "user" }]);
      expect(await find(`  ${email.toUpperCase()}  `)).toEqual([{ user_id: id, role: "user" }]);
      expect(await find(email.slice(0, 12))).toEqual([]);
      expect(await find("%")).toEqual([]);
      expect(await find("%@example.com")).toEqual([]);
      expect(await find("nobody@example.com")).toEqual([]);
    });
  });

  describe("a role change needs a matching entry of the same transaction", () => {
    it("refuses ops_set_user_role without an entry, with a foreign-transaction entry and with another role", async () => {
      const { id } = await newAccount();

      await expect(
        withClient(db.urls.krajozbior_ops, (client) => setRole(client, id, "admin")),
      ).rejects.toMatchObject(refusedWithoutEntry);

      // An entry from another, committed transaction does not count.
      await withClient(db.urls.krajozbior_ops, (client) => writeEntry(client, id, "admin"));
      await expect(
        withClient(db.urls.krajozbior_ops, (client) => setRole(client, id, "admin")),
      ).rejects.toMatchObject(refusedWithoutEntry);

      // An entry for another role does not count either.
      await expect(
        withClient(db.urls.krajozbior_ops, async (client) => {
          await client.query("begin");
          await writeEntry(client, id, "user");
          await setRole(client, id, "admin");
        }),
      ).rejects.toMatchObject(refusedWithoutEntry);
      expect(await roleOf(id)).toBe("user");
    });

    it("reports a missing account with P0002", async () => {
      const id = randomUUID();

      await expect(
        withClient(db.urls.krajozbior_ops, async (client) => {
          await client.query("begin");
          await writeEntry(client, id, "admin");
          await setRole(client, id, "admin");
        }),
      ).rejects.toMatchObject({ code: "P0002" });
    });

    it("changes the role with the right entry in the same transaction", async () => {
      const { id } = await newAccount();
      const previous = await withClient(db.urls.krajozbior_ops, async (client) => {
        await client.query("begin");
        await writeEntry(client, id, "admin");
        const result = await setRole(client, id, "admin");

        await client.query("commit");

        return result.rows[0]!.ops_set_user_role;
      });

      expect(previous).toBe("user");
      expect(await roleOf(id)).toBe("admin");
    });

    it("limits one entry to one account and one target role", async () => {
      const a = await newAccount();
      const b = await newAccount();

      await expect(
        withClient(db.urls.krajozbior_ops, async (client) => {
          await client.query("begin");
          await writeEntry(client, a.id, "admin");
          await setRole(client, a.id, "admin");
          await setRole(client, b.id, "admin");
        }),
      ).rejects.toMatchObject(refusedWithoutEntry);
      await expect(
        withClient(db.urls.krajozbior_ops, async (client) => {
          await client.query("begin");
          await writeEntry(client, a.id, "admin");
          await setRole(client, a.id, "admin");
          await setRole(client, a.id, "user");
        }),
      ).rejects.toMatchObject(refusedWithoutEntry);
      expect([await roleOf(a.id), await roleOf(b.id)]).toEqual(["user", "user"]);
    });

    it("counts an entry written in a released savepoint, not one rolled back, not one of another transaction", async () => {
      const released = await newAccount();
      const rolledBack = await newAccount();

      await withClient(db.urls.krajozbior_ops, async (client) => {
        await client.query("begin");
        await client.query("savepoint s");
        await writeEntry(client, released.id, "admin");
        await client.query("release savepoint s");
        await setRole(client, released.id, "admin");
        await client.query("commit");
      });
      expect(await roleOf(released.id)).toBe("admin");

      await expect(
        withClient(db.urls.krajozbior_ops, async (client) => {
          await client.query("begin");
          await client.query("savepoint s");
          await writeEntry(client, rolledBack.id, "admin");
          await client.query("rollback to savepoint s");
          await setRole(client, rolledBack.id, "admin");
        }),
      ).rejects.toMatchObject(refusedWithoutEntry);
      expect(await roleOf(rolledBack.id)).toBe("user");
    });

    it("binds krajozbior_owner and the cluster superuser too, but lets a change without `role` through", async () => {
      const { id, email } = await newAccount();

      for (const url of [db.urls.krajozbior_owner, db.adminUrl]) {
        await expect(
          withClient(url, (client) =>
            client.query(`update auth.users set role = 'admin' where id = $1`, [id]),
          ),
        ).rejects.toMatchObject(refusedWithoutEntry);
        await expect(
          withClient(url, (client) =>
            client.query(`insert into auth.users (name, email, role) values ('x', $1, 'admin')`, [
              `other-${randomUUID()}@example.com`,
            ]),
          ),
        ).rejects.toMatchObject(refusedWithoutEntry);
        await withClient(url, (client) =>
          client.query(`update auth.users set name = 'Renamed' where id = $1`, [id]),
        );
        // The same role is not a change.
        await withClient(url, (client) =>
          client.query(`update auth.users set role = role where id = $1`, [id]),
        );
      }

      expect(await admin$(`select role, name from auth.users where email = $1`, [email])).toEqual([
        { role: "user", name: "Renamed" },
      ]);
    });

    it("lets registration and sign-in through without an entry", async () => {
      const before = await auditCount();
      const email = `${randomUUID()}@example.com`;

      await as$("krajozbior_auth", `insert into auth.users (name, email) values ('x', $1)`, [
        email,
      ]);
      await as$(
        "krajozbior_auth",
        `update auth.users set name = 'y', updated_at = now() where email = $1`,
        [email],
      );

      expect(await auditCount()).toBe(before);
    });

    it("has the two triggers with their WHEN conditions in the catalog", async () => {
      const rows = await admin$<{ tgname: string; def: string }>(
        `select tgname, pg_get_triggerdef(oid) as def from pg_trigger
          where tgrelid = 'auth.users'::regclass and not tgisinternal order by tgname`,
      );

      expect(rows.map(({ tgname }) => tgname)).toEqual([
        "auth_users_role_audited_insert",
        "auth_users_role_audited_update",
      ]);
      expect(rows[0]!.def).toMatch(/WHEN \(\(new\.role <> 'user'::text\)\)/);
      expect(rows[1]!.def).toMatch(/UPDATE OF role/);
      expect(rows[1]!.def).toMatch(/WHEN \(\(old\.role IS DISTINCT FROM new\.role\)\)/);
    });
  });
});
