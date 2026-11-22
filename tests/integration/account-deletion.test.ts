import { randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { Pool, type Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SoleOrganizationMemberError } from "@/features/identity/domain/identity-provider";
import { deleteAccountRows } from "@/features/identity/infrastructure/delete-account-rows";
import { AUDIT_OPERATIONS } from "@/lib/db/operations-audit";
import { createOrmConfig } from "@/lib/db/config";
import { albumFixtures, newUser, rejectedByPolicy } from "../support/album-fixtures";
import {
  closePool,
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// E9-5: deleting an account on the real database, through real LOGIN roles
// (D-E9-3, Q8, Q9; spec sections 5.4 and 7). krajozbior_auth deletes the account;
// the foreign keys cascade to every table of the product although the tables have
// FORCE ROW LEVEL SECURITY and the role has no privilege on them; the database
// itself writes the audit entry. The superuser only prepares data and reads the
// catalog. Two connections of the owner role appear on purpose, and only to try
// the one way that is meant to stay shut (see "the narrow exception").
const denied = { code: "42501" };
const guardRefusal = { code: "55000" };

let db: ScratchDatabase;
let app: MikroORM;
let authPool: Pool;

const f = albumFixtures({ db: () => db, app: () => app });
const { admin$, as } = f;

type Role = "krajozbior_app" | "krajozbior_auth" | "krajozbior_ops" | "krajozbior_owner";

const as$ = (role: Role, sql: string, params: unknown[] = []) =>
  withClient(db.urls[role], (client) => client.query(sql, params));

const curator = newUser("curator");
const orgOwner = newUser("org-owner");
let orgId = "";
let collectionId = "";
let placeId = "";

async function newExplorer(name: string) {
  const user = newUser(`${name}-${randomUUID().slice(0, 8)}`);

  await f.insertUsers([user]);

  return user;
}

// Everything an explorer owns in the product, made the way the application makes
// it (krajozbior_app in the user's own context), plus the auth rows around it.
async function populate(user: { id: string; email: string }) {
  await as(
    user,
    `insert into public.visits (user_id, place_id, kind, date_precision)
     values (app_current_user_id(), ?, 'past', 'unknown')`,
    [placeId],
  );
  await as(
    user,
    `insert into public.saved_collections (user_id, collection_id) values (app_current_user_id(), ?)`,
    [collectionId],
  );
  await as(
    user,
    `insert into public.want_to_see_places (user_id, place_id) values (app_current_user_id(), ?)`,
    [placeId],
  );
  // An own collection with an entry (E8-1a): the deletion removes both (E8-Q6).
  const [own] = await as(
    user,
    `insert into public.user_collections (title, region) values ('Własna', 'polska') returning id`,
  );

  await as(
    user,
    `insert into public.user_collection_items (user_collection_id, position, place_id)
     values (?, 1, ?)`,
    [own!.id, placeId],
  );
  // The profile (E9-2): a name, an initial and a region the deletion must remove.
  await as(
    user,
    `insert into public.profiles (first_name, family_initial, region, visibility)
     values ('Anna', 'K', 'pomorskie', 'public')`,
  );
  // The theme remembered on the account (E9-4).
  await as(user, `insert into public.account_settings (theme) values ('light')`);
  // The acceptance of the terms (F-K3): evidence that goes with the account.
  await as(user, `insert into public.terms_acceptance (terms_version) values ('0.2')`);
  // A membership of its own organization, with a colleague, so the account may go.
  const ownOrganization = await f.newOrganization(`Gmina ${user.id}`, `gmina-${user.id}`, [
    user,
    orgOwner,
  ]);

  // An official photo whose rights statement the account filed (E4-2a): the photo stays when the
  // account goes, `created_by` is cleared (the superuser prepares it; the app role cannot name it).
  const [{ id: photoPlaceId }] = await admin$<{ id: string }>(
    `insert into public.places (organization_id, name, latitude, longitude)
     values ($1, 'Miejsce ze zdjęciem', 54.1, 18.7) returning id`,
    [ownOrganization],
  );

  await admin$(
    `insert into public.place_photos
       (organization_id, place_id, position, file_state, alt_text, source_kind, author_text,
        source_url, license_code, license_url, license_label, rights_statement, commons_file,
        created_by)
     values ($1, $2, 1, 'pending_fetch', 'Opis', 'commons_import', 'Autor',
             'https://commons.wikimedia.org/wiki/File:X.jpg', 'cc-by-4.0',
             'https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0', 'commons-import/1',
             'X.jpg', $3)`,
    [ownOrganization, photoPlaceId, user.id],
  );
  await admin$(
    `insert into auth.sessions (expires_at, token, user_id) values (now() + interval '1 day', $1, $2)`,
    [randomUUID(), user.id],
  );
  await admin$(
    `insert into auth.accounts (account_id, provider_id, user_id) values ($1, 'credential', $2)`,
    [user.id, user.id],
  );
  await admin$(
    `insert into auth.verifications (identifier, value, expires_at)
     values ($1, 'x', now() + interval '10 minutes')`,
    [`sign-in-otp-${user.email}`],
  );
  await admin$(
    `insert into auth.sign_in_throttle (key, attempts) values ($1, 1), ($2, 1), ($3, 1)`,
    [
      `action:want_to_see_write:${user.id}`,
      `action:save_collection:${user.id}`,
      // Keyed by an HMAC of the address: stays until it expires (D-E9-3).
      `account:hmac-${user.id}`,
    ],
  );
}

type FkRow = { table: string; column: string };

// Every column that references auth.users, in any schema other than auth's own
// users table: the tables the deletion must empty of the account.
const referencingColumns = () =>
  admin$<FkRow>(
    `select n.nspname || '.' || r.relname as "table", a.attname as "column"
       from pg_constraint c
       join pg_class r on r.oid = c.conrelid
       join pg_namespace n on n.oid = r.relnamespace
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
      order by 1, 2`,
  );

const rowsOf = async (table: string, column: string, id: string) =>
  Number(
    (
      await admin$<{ n: string }>(`select count(*) as n from ${table} where ${column} = $1`, [id])
    )[0]!.n,
  );

const deletionEntries = (id: string) =>
  admin$<Record<string, unknown>>(
    `select * from public.operations_audit where operation = 'delete_account' and subject_user_id = $1`,
    [id],
  );

const entryCount = async () =>
  Number((await admin$<{ n: string }>(`select count(*) as n from public.operations_audit`))[0]!.n);

// A clean `delete_account` entry for the given (row-less) account, as the trigger writes it.
const entrySql = `insert into public.operations_audit
  (operation, operator_label, subject_user_id, outcome, reason)
  values ('delete_account', 'x', $1, 'applied', 'r')`;

describe("account deletion on the real database", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_account_deletion");
    await db.migrate();
    await f.insertUsers([curator, orgOwner]);
    orgId = await f.newOrganization("Gmina A", "gmina-a", [curator]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
    authPool = new Pool({ connectionString: db.urls.krajozbior_auth, max: 3 });
    const published = await f.publishedCollection(curator, orgId, 1);

    collectionId = published.collectionId;
    placeId = published.placeIds[0]!;
  }, 60_000);

  afterAll(async () => {
    await closePool(authPool);
    await app?.close(true);
    await db?.drop();
  });

  describe("the cascade, with the roles of production", () => {
    it("has row security forced on every table that references the account, so the cascade is tried against it", async () => {
      const referencing = (await referencingColumns()).filter(({ table }) =>
        table.startsWith("public."),
      );
      const unforced = await admin$<{ table: string }>(
        `select c.oid::regclass::text as "table" from pg_class c
          where c.oid = any($1::regclass[]) and not (c.relrowsecurity and c.relforcerowsecurity)`,
        [referencing.map(({ table }) => table)],
      );

      expect(referencing.map(({ table }) => table)).toEqual(
        expect.arrayContaining([
          "public.organization_members",
          "public.profiles",
          "public.account_settings",
          "public.saved_collections",
          "public.terms_acceptance",
          "public.visits",
          "public.want_to_see_places",
        ]),
      );
      expect(unforced).toEqual([]);
    });

    it("lets krajozbior_auth delete the account and removes everything of A, and nothing of B", async () => {
      const a = await newExplorer("a");
      const b = await newExplorer("b");

      await populate(a);
      await populate(b);
      const columns = await referencingColumns();

      expect(await deleteAccountRows(authPool, a.id)).toBe(true);

      for (const { table, column } of columns) {
        expect(await rowsOf(table, column, a.id), `${table}.${column} of A`).toBe(0);
        expect(await rowsOf(table, column, b.id), `${table}.${column} of B`).toBeGreaterThan(0);
      }
      expect(await rowsOf("auth.users", "id", a.id)).toBe(0);
      expect(await rowsOf("auth.verifications", "identifier", `sign-in-otp-${a.email}`)).toBe(0);
      // The action limits of A go; the counter keyed by an HMAC stays until it expires.
      expect(
        (
          await admin$<{ key: string }>(
            `select key from auth.sign_in_throttle where key like $1 order by key`,
            [`%${a.id}`],
          )
        ).map(({ key }) => key),
      ).toEqual([`account:hmac-${a.id}`]);
      expect(await rowsOf("auth.sign_in_throttle", "key", `action:want_to_see_write:${b.id}`)).toBe(
        1,
      );
    });

    it("leaves no address of A in clear text in any table of the auth schema, nor in the audit", async () => {
      const a = await newExplorer("address");

      await populate(a);
      await deleteAccountRows(authPool, a.id);

      const tables = await admin$<{ table: string }>(
        `select c.oid::regclass::text as "table" from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('auth', 'public') and c.relkind = 'r' and c.relname <> 'mikro_orm_migrations'`,
      );

      for (const { table } of tables) {
        const hits = await admin$(
          `select 1 from ${table} t where row_to_json(t)::text ilike '%' || $1 || '%'`,
          [a.email.split("@")[0]],
        );

        expect(hits, `${table} mentions the address of A`).toEqual([]);
      }
    });

    it("shows krajozbior_app nothing of A in the context of A after the deletion", async () => {
      const a = await newExplorer("ctx");

      await populate(a);
      await deleteAccountRows(authPool, a.id);

      for (const table of [
        "visits",
        "saved_collections",
        "want_to_see_places",
        "profiles",
        "account_settings",
        "terms_acceptance",
      ]) {
        expect(await as(a, `select * from public.${table}`), table).toEqual([]);
      }
    });

    it("is idempotent: a second deletion of the same account reports false and writes no second entry", async () => {
      const a = await newExplorer("twice");

      expect(await deleteAccountRows(authPool, a.id)).toBe(true);
      expect(await deleteAccountRows(authPool, a.id)).toBe(false);
      expect(await deletionEntries(a.id)).toHaveLength(1);
    });
  });

  describe("the audit entry, written by the database", () => {
    it("leaves exactly one delete_account entry of the deleting transaction, without an address or a name", async () => {
      const a = await newExplorer("entry");

      await populate(a);
      // The same statements the adapter runs, in one transaction of krajozbior_auth,
      // so the transaction id can be compared; nothing here writes to the audit.
      const xid = await withClient(db.urls.krajozbior_auth, async (client) => {
        await client.query("begin");
        const { rows } = await client.query(`select pg_current_xact_id()::text as xid`);

        await client.query(`delete from auth.users where id = $1`, [a.id]);
        await client.query("commit");

        return rows[0].xid as string;
      });
      const entries = await deletionEntries(a.id);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        operation: "delete_account",
        outcome: "applied",
        subject_user_id: a.id,
        operator_label: "self-service",
        recorded_by: "krajozbior_auth",
        organization_id: null,
        before_state: null,
        after_state: null,
        error_code: null,
        reason: "account deleted",
      });
      expect(String(entries[0]!.transaction_id)).toBe(xid);
      expect(JSON.stringify(entries[0])).not.toContain(a.email.split("@")[0]);
    });

    it("leaves no entry when the deletion is rolled back", async () => {
      const a = await newExplorer("rollback");
      const before = await entryCount();

      await withClient(db.urls.krajozbior_auth, async (client) => {
        await client.query("begin");
        await client.query(`delete from auth.users where id = $1`, [a.id]);
        await client.query("rollback");
      });

      expect(await entryCount()).toBe(before);
      expect(await rowsOf("auth.users", "id", a.id)).toBe(1);
    });

    it("writes one entry for every account removed by one statement", async () => {
      const [x, y] = [await newExplorer("many-x"), await newExplorer("many-y")];

      await as$("krajozbior_auth", `delete from auth.users where id = any($1::uuid[])`, [
        [x.id, y.id],
      ]);

      expect(await deletionEntries(x.id)).toHaveLength(1);
      expect(await deletionEntries(y.id)).toHaveLength(1);
    });

    it("is recorded by the operator with a declared label, and an unusable label falls back to the role (V4)", async () => {
      const declared = await newExplorer("label");
      const control = await newExplorer("control");
      const forged = await newExplorer("forged");
      const run = (id: string, label: string, url: string) =>
        withClient(url, async (client) => {
          await client.query("begin");
          await client.query(`select set_config('krajozbior.operator_label', $1, true)`, [label]);
          await client.query(`delete from auth.users where id = $1`, [id]);
          await client.query("commit");
        });

      await run(declared.id, "Jan K.", db.adminUrl);
      await run(control.id, "line\nbreak", db.adminUrl);
      // The identity role cannot name itself anything but "self-service".
      await run(forged.id, "Operator", db.urls.krajozbior_auth);

      expect((await deletionEntries(declared.id))[0]).toMatchObject({ operator_label: "Jan K." });
      const role = (await deletionEntries(control.id))[0]!;

      expect(role.operator_label).toBe(role.recorded_by);
      expect((await deletionEntries(forged.id))[0]).toMatchObject({
        operator_label: "self-service",
        recorded_by: "krajozbior_auth",
      });
    });

    it("knows delete_account in the list of operations the code keeps next to the CHECK (V5)", async () => {
      expect(AUDIT_OPERATIONS).toContain("delete_account");
    });
  });

  describe("the entry exists only as a result of the deletion", () => {
    it("lets neither krajozbior_auth nor krajozbior_app insert, change, delete or truncate", async () => {
      const live = await newExplorer("narrow");

      for (const role of ["krajozbior_auth", "krajozbior_app"] as const) {
        for (const statement of [
          [entrySql, [live.id]],
          [entrySql, [randomUUID()]],
          [`update public.operations_audit set reason = 'x'`, []],
          [`delete from public.operations_audit`, []],
          [`truncate public.operations_audit`, []],
        ] as const) {
          await expect(
            as$(role, statement[0], [...statement[1]]),
            `${role}: ${statement[0]}`,
          ).rejects.toMatchObject(denied);
        }
      }
    });

    it("has no privilege of krajozbior_auth on the audit, on the product tables or to truncate auth.users (V3)", async () => {
      const tables = (await referencingColumns())
        .map(({ table }) => table)
        .filter((table) => table.startsWith("public."));
      const grants = await admin$<{ granted: boolean; what: string }>(
        `select has_table_privilege('krajozbior_auth', t, 'select, insert, update, delete, truncate, references, trigger')
                or has_any_column_privilege('krajozbior_auth', t, 'select, insert, update, references') as granted,
                t as what
           from unnest($1::text[]) as t`,
        [["public.operations_audit", ...tables]],
      );
      const [truncate] = await admin$<{ allowed: boolean }>(
        `select has_table_privilege('krajozbior_auth', 'auth.users', 'truncate') as allowed`,
      );

      expect(grants.filter(({ granted }) => granted)).toEqual([]);
      expect(truncate!.allowed).toBe(false);
      await expect(as$("krajozbior_auth", `truncate auth.users`)).rejects.toMatchObject(denied);
    });

    it("refuses krajozbior_ops the entry: a policy violation for an account that is gone, the guard for a live one", async () => {
      const live = await newExplorer("ops-live");

      await expect(as$("krajozbior_ops", entrySql, [randomUUID()])).rejects.toThrow(
        rejectedByPolicy,
      );
      // The guard (BEFORE trigger) runs before the policy check.
      await expect(as$("krajozbior_ops", entrySql, [live.id])).rejects.toMatchObject(guardRefusal);
    });

    it("keeps the operator's own operations working", async () => {
      await expect(
        as$(
          "krajozbior_ops",
          `insert into public.operations_audit (operation, operator_label, outcome, reason)
           values ('grant_curator', 'tester', 'applied', 'Test')`,
        ),
      ).resolves.toBeDefined();
    });

    it("lets the guard refuse every unclean entry even from the owner, the only role with the insert policy", async () => {
      const live = await newExplorer("guard");
      const gone = randomUUID();
      const insert = (columns: string, values: string, params: unknown[]) =>
        as$(
          "krajozbior_owner",
          `insert into public.operations_audit (operation, operator_label, reason, ${columns})
           values ('delete_account', 'x', 'r', ${values})`,
          params,
        );

      await expect(
        insert("outcome, subject_user_id", "'applied', $1", [live.id]),
      ).rejects.toMatchObject(guardRefusal);
      await expect(insert("outcome", "'applied'", [])).rejects.toMatchObject(guardRefusal);
      await expect(
        insert("outcome, subject_user_id, error_code", "'rejected', $1, 'user_not_found'", [gone]),
      ).rejects.toMatchObject(guardRefusal);
      await expect(
        insert("outcome, subject_user_id, organization_id", "'applied', $1, $2", [gone, orgId]),
      ).rejects.toMatchObject(guardRefusal);
      await expect(
        insert("outcome, subject_user_id, before_state", "'applied', $1, '{}'::jsonb", [gone]),
      ).rejects.toMatchObject(guardRefusal);
      await expect(
        insert("outcome, subject_user_id, after_state", "'applied', $1, '{}'::jsonb", [gone]),
      ).rejects.toMatchObject(guardRefusal);
    });

    it("does not let the owner write any other operation (V1): the policy is the one narrow exception", async () => {
      for (const operation of AUDIT_OPERATIONS.filter((name) => name !== "delete_account")) {
        await expect(
          as$(
            "krajozbior_owner",
            `insert into public.operations_audit (operation, operator_label, outcome, reason)
             values ($1, 'x', 'applied', 'r')`,
            [operation],
          ),
          operation,
        ).rejects.toThrow(rejectedByPolicy);
      }
    });

    it("has exactly the expected insert policies on the audit, and no change or delete policy for the owner (V1)", async () => {
      const policies = await admin$<{
        name: string;
        roles: string;
        cmd: string;
        check: string | null;
      }>(
        `select policyname as name, roles::text as roles, cmd, with_check as "check"
           from pg_policies where schemaname = 'public' and tablename = 'operations_audit'
          order by policyname`,
      );
      const inserts = policies.filter(({ cmd }) => cmd === "INSERT");
      const owner = inserts.find(({ roles }) => roles.includes("krajozbior_owner"))!;
      const ops = inserts.find(({ roles }) => roles.includes("krajozbior_ops"))!;

      expect(inserts.map(({ name }) => name).sort()).toEqual([
        "operations_audit_account_deletion_insert",
        "operations_audit_ops_insert",
      ]);
      expect(owner.name).toBe("operations_audit_account_deletion_insert");
      for (const part of [
        "operation = 'delete_account'",
        "outcome = 'applied'",
        "organization_id IS NULL",
        "before_state IS NULL",
        "after_state IS NULL",
      ]) {
        expect(owner.check, part).toContain(part);
      }
      expect(ops.check).toContain("operation <> 'delete_account'");
      expect(
        policies.filter(
          ({ roles, cmd }) =>
            roles.includes("krajozbior_owner") && cmd !== "SELECT" && cmd !== "INSERT",
        ),
      ).toEqual([]);
    });

    it("lets no login role call the trigger functions", async () => {
      for (const fn of ["auth_users_audit_deletion()", "operations_audit_delete_account_guard()"]) {
        for (const role of ["krajozbior_app", "krajozbior_auth", "krajozbior_ops"] as const) {
          await expect(as$(role, `select public.${fn}`), `${role} ${fn}`).rejects.toMatchObject(
            denied,
          );
        }
        const [{ any }] = await admin$<{ any: boolean }>(
          `select bool_or(has_function_privilege(r, $1, 'execute')) as any
             from unnest(array['krajozbior_app', 'krajozbior_auth', 'krajozbior_ops']) as r`,
          [`public.${fn}`],
        );

        expect(any, fn).toBe(false);
      }
    });

    it("does not let krajozbior_auth or krajozbior_ops switch the triggers off", async () => {
      for (const role of ["krajozbior_auth", "krajozbior_ops"] as const) {
        for (const statement of [
          `alter table auth.users disable trigger auth_users_deletion_audited`,
          `alter table auth.users disable trigger all`,
          `alter table public.operations_audit disable trigger operations_audit_delete_account_guard`,
          `drop trigger auth_users_deletion_audited on auth.users`,
        ]) {
          await expect(as$(role, statement), `${role}: ${statement}`).rejects.toThrow();
        }
      }
    });
  });

  describe("grants", () => {
    it("gives krajozbior_app no delete on the tables of profile and settings (when they exist) and no insert for another user", async () => {
      const [row] = await admin$<{ bad: boolean }>(
        `select coalesce(bool_or(has_table_privilege('krajozbior_app', t, 'delete')), false) as bad
           from unnest(array['public.profiles', 'public.account_settings']) as t
          where to_regclass(t) is not null`,
      );
      const a = await newExplorer("grant-a");
      const b = await newExplorer("grant-b");

      expect(row!.bad).toBe(false);
      await expect(
        as(a, `insert into public.want_to_see_places (user_id, place_id) values (?, ?)`, [
          b.id,
          placeId,
        ]),
      ).rejects.toThrow(rejectedByPolicy);
    });
  });

  describe("the race with a write", () => {
    const setUserContext = (client: Client, id: string) =>
      client.query(`select set_config('app.user_id', $1, true)`, [id]);
    const insertVisit = (client: Client) =>
      client.query(
        `insert into public.visits (user_id, place_id, kind, date_precision)
         values (app_current_user_id(), $1, 'past', 'unknown')`,
        [placeId],
      );

    it("deletes a visit saved at the same time: the deletion waits for the write and removes its row too", async () => {
      const a = await newExplorer("race-before");

      await withClient(db.urls.krajozbior_app, async (client) => {
        await client.query("begin");
        await setUserContext(client, a.id);
        await insertVisit(client);

        let finished = false;
        const deletion = deleteAccountRows(authPool, a.id).then((result) => {
          finished = true;

          return result;
        });

        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(finished, "the deletion must wait for the open write").toBe(false);

        await client.query("commit");
        expect(await deletion).toBe(true);
      });

      expect(await rowsOf("public.visits", "user_id", a.id)).toBe(0);
      expect(await rowsOf("auth.users", "id", a.id)).toBe(0);
    });

    it("refuses a visit saved after the deletion (foreign key), so no row of A is left", async () => {
      const a = await newExplorer("race-after");

      await withClient(db.urls.krajozbior_app, async (client) => {
        await client.query("begin");
        await setUserContext(client, a.id);
        expect(await deleteAccountRows(authPool, a.id)).toBe(true);
        await expect(insertVisit(client)).rejects.toMatchObject({ code: "23503" });
        await client.query("rollback");
      });

      expect(await rowsOf("public.visits", "user_id", a.id)).toBe(0);
    });
  });

  describe("who is the only member of an organization (Q8)", () => {
    const sole = (user: { id: string }) =>
      as(user, `select public.app_is_sole_organization_member() as sole`).then(
        (rows) => rows[0]!.sole as boolean,
      );

    it("is true for the only member, false with another member or none, and cannot be called by other roles", async () => {
      const second = await newExplorer("second-member");
      const none = await newExplorer("no-member");
      const first = await newExplorer("first-member");
      const twoOrg = await f.newOrganization("Gmina B", "gmina-b", [first, second]);

      expect(await sole(curator)).toBe(true);
      expect(await sole(none)).toBe(false);
      // `first` shares `twoOrg` with `second`, so neither is alone.
      expect(await sole(first)).toBe(false);
      expect(await sole(second)).toBe(false);
      // A member of two organizations is "sole" if any of them has nobody else.
      await admin$(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [orgId, none.id],
      );
      expect(await sole(curator)).toBe(false);
      await admin$(
        `delete from public.organization_members where organization_id = $1 and user_id = $2`,
        [orgId, none.id],
      );
      expect(twoOrg).toBeTruthy();

      for (const role of ["krajozbior_auth", "krajozbior_ops"] as const) {
        await expect(
          as$(role, `select public.app_is_sole_organization_member()`),
          role,
        ).rejects.toMatchObject(denied);
      }
    });

    it("never leaves an organization empty when its last two members are deleted at the same time (m1)", async () => {
      const one = await newExplorer("last-one");
      const two = await newExplorer("last-two");
      const shared = await f.newOrganization("Gmina D", "gmina-d", [one, two]);

      // Deterministic: transaction A deletes the first account and stays open.
      // B (the second deletion) must stand on the advisory lock of the
      // organization taken by the trigger; the test waits until pg_locks shows
      // it. Only then A commits, B sees the result and is refused. Without the
      // lock B would not wait: it would see the first membership still present
      // (A is uncommitted), succeed, and the organization would be left empty.
      let secondDeletion: Promise<boolean> | undefined;
      let waiting = false;

      await withClient(db.urls.krajozbior_auth, async (client) => {
        await client.query("begin");
        await client.query(`delete from auth.users where id = $1::uuid`, [one.id]);

        secondDeletion = deleteAccountRows(authPool, two.id);
        // Attach the handler now, so a refusal is never reported as unhandled.
        const outcome = secondDeletion.then(
          () => "fulfilled",
          () => "rejected",
        );

        for (let i = 0; i < 200 && !waiting; i += 1) {
          waiting =
            Number(
              (
                await admin$<{ n: string }>(
                  `select count(*) as n from pg_locks
                    where locktype = 'advisory' and not granted
                      and database = (select oid from pg_database where datname = current_database())`,
                )
              )[0]!.n,
            ) > 0;
          if (!waiting) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }

        // While A is open, B has neither finished nor removed anything.
        expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
        expect(await rowsOf("auth.users", "id", two.id)).toBe(1);

        await client.query("commit");
      });

      expect(waiting).toBe(true);
      await expect(secondDeletion!).rejects.toBeInstanceOf(SoleOrganizationMemberError);
      expect(await rowsOf("auth.users", "id", one.id)).toBe(0);
      expect(await rowsOf("auth.users", "id", two.id)).toBe(1);
      expect(await rowsOf("public.organization_members", "organization_id", shared)).toBe(1);
      expect(await rowsOf("public.organization_members", "user_id", two.id)).toBe(1);
    });

    it("refuses to delete the only member directly, and leaves the account and membership intact", async () => {
      const alone = await newExplorer("alone");
      const org = await f.newOrganization("Gmina E", "gmina-e", [alone]);

      await expect(deleteAccountRows(authPool, alone.id)).rejects.toBeInstanceOf(
        SoleOrganizationMemberError,
      );
      expect(await rowsOf("auth.users", "id", alone.id)).toBe(1);
      expect(await rowsOf("public.organization_members", "organization_id", org)).toBe(1);
    });

    it("keeps the organization and its content when a curator with a colleague is deleted", async () => {
      const colleague = await newExplorer("colleague");
      const leaving = await newExplorer("leaving");
      const shared = await f.newOrganization("Gmina C", "gmina-c", [colleague, leaving]);
      const content = await f.publishedCollection(colleague, shared, 1);

      expect(await sole(leaving)).toBe(false);
      await deleteAccountRows(authPool, leaving.id);

      expect(await rowsOf("public.organization_members", "user_id", leaving.id)).toBe(0);
      expect(await rowsOf("public.organizations", "id", shared)).toBe(1);
      expect(await rowsOf("public.collections", "id", content.collectionId)).toBe(1);
      expect(await rowsOf("public.places", "id", content.placeIds[0]!)).toBe(1);
    });
  });
});
