import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOrmConfig } from "@/lib/db/config";
import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

let db: ScratchDatabase;
let orm: MikroORM;

type CatalogState = { migrationTable: string | null; userFunction: string | null };

const catalogState = (em: MikroORM["em"]) =>
  em.execute<CatalogState>(
    `select
       to_regclass('public.mikro_orm_migrations')::text as "migrationTable",
       to_regprocedure('public.app_current_user_id()')::text as "userFunction"`,
    [],
    "get",
  );

describe("PostgreSQL migrations and transactions", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_migrations");
    orm = await MikroORM.init(createOrmConfig(db.adminUrl));
  }, 30_000);

  afterAll(async () => {
    await orm?.close(true);
    await db?.drop();
  });

  it("refuses to apply the migrations as any role other than krajozbior_owner", async () => {
    await expect(orm.migrator.up()).rejects.toThrow(/Migrations must run as krajozbior_owner/);
    expect(await catalogState(orm.em)).toMatchObject({ userFunction: null });
    // The migrator creates its own bookkeeping table before the guard runs.
    await orm.em.execute("drop table if exists mikro_orm_migrations");
  });

  it("applies the migrations to an empty database as krajozbior_owner", async () => {
    await db.migrate();

    const after = await catalogState(orm.em);
    const currentUser = await orm.em.execute<{ userId: string | null }>(
      `select app_current_user_id() as "userId"`,
      [],
      "get",
    );
    const owners = await orm.em.execute<{ owner: string }[]>(
      `select distinct pg_get_userbyid(c.relowner) as owner
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'auth') and c.relkind = 'r'`,
    );
    const authTables = await orm.em.execute<{ table: string }[]>(
      `select c.relname as "table" from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'auth' and c.relkind = 'r' order by c.relname`,
    );

    expect(after.migrationTable).toBe("mikro_orm_migrations");
    expect(after.userFunction).toBe("app_current_user_id()");
    expect(currentUser).toEqual({ userId: null });
    expect(owners).toEqual([{ owner: "krajozbior_owner" }]);
    expect(authTables.map(({ table }) => table)).toEqual([
      "accounts",
      "otp_send_counters",
      "sessions",
      "sign_in_throttle",
      "users",
      "verifications",
    ]);
  });

  it("reverts the sign-in throttle table and applies it again", async () => {
    const owner = await MikroORM.init(createOrmConfig(db.urls.krajozbior_owner));
    const throttle = () =>
      orm.em.execute<{ table: string | null }>(
        `select to_regclass('auth.sign_in_throttle')::text as table`,
        [],
        "get",
      );

    try {
      await owner.migrator.down({ to: "Migration20261116120100_auth_schema" });
      expect(await throttle()).toEqual({ table: null });

      await owner.migrator.up();
      expect(await throttle()).toEqual({ table: "auth.sign_in_throttle" });
    } finally {
      await owner.close(true);
    }
  });

  it("reverts the organizations migration and applies it again", async () => {
    const owner = await MikroORM.init(createOrmConfig(db.urls.krajozbior_owner));
    const objects = () =>
      orm.em.execute<{ organizations: string | null; audit: string | null; fn: string | null }>(
        `select to_regclass('public.organizations')::text as organizations,
                to_regclass('public.operations_audit')::text as audit,
                to_regprocedure('public.app_org_permission(uuid)')::text as fn`,
        [],
        "get",
      );

    try {
      await owner.migrator.down({ to: "Migration20261117120000_otp_send_counters" });
      expect(await objects()).toEqual({ organizations: null, audit: null, fn: null });

      await owner.migrator.up();
      expect(await objects()).toEqual({
        organizations: "organizations",
        audit: "operations_audit",
        fn: "app_org_permission(uuid)",
      });
    } finally {
      await owner.close(true);
    }
  });

  it("reverts the catalog migration (no CASCADE needed) and applies it again", async () => {
    const owner = await MikroORM.init(createOrmConfig(db.urls.krajozbior_owner));
    const objects = () =>
      orm.em.execute<{
        collections: string | null;
        places: string | null;
        links: string | null;
        fn: string | null;
        organizations: string | null;
      }>(
        `select to_regclass('public.collections')::text as collections,
                to_regclass('public.places')::text as places,
                to_regclass('public.collection_places')::text as links,
                to_regprocedure('public.collections_publication()')::text as fn,
                to_regclass('public.organizations')::text as organizations`,
        [],
        "get",
      );

    try {
      await owner.migrator.down({ to: "Migration20261117130000_organizations_ops_audit" });
      expect(await objects()).toEqual({
        collections: null,
        places: null,
        links: null,
        fn: null,
        organizations: "organizations",
      });

      await owner.migrator.up();
      expect(await objects()).toEqual({
        collections: "collections",
        places: "places",
        links: "collection_places",
        fn: "collections_publication()",
        organizations: "organizations",
      });
    } finally {
      await owner.close(true);
    }
  });

  it("reverts the album migration (no CASCADE needed) and applies it again", async () => {
    const owner = await MikroORM.init(createOrmConfig(db.urls.krajozbior_owner));
    const objects = () =>
      orm.em.execute<{
        saved: string | null;
        want: string | null;
        visits: string | null;
        fn: string | null;
        collections: string | null;
        ownerPolicies: string;
      }>(
        `select to_regclass('public.saved_collections')::text as saved,
                to_regclass('public.want_to_see_places')::text as want,
                to_regclass('public.visits')::text as visits,
                to_regprocedure('public.record_on_site_visit(uuid, double precision, double precision, double precision, uuid)')::text as fn,
                to_regclass('public.collections')::text as collections,
                (select count(*) from pg_policies
                  where tablename in ('collections', 'collection_places', 'places')
                    and 'krajozbior_owner' = any (roles))::text as "ownerPolicies"`,
        [],
        "get",
      );

    try {
      await owner.migrator.down({ to: "Migration20261117140000_catalog" });
      expect(await objects()).toEqual({
        saved: null,
        want: null,
        visits: null,
        fn: null,
        collections: "collections",
        ownerPolicies: "0",
      });

      await owner.migrator.up();
      expect(await objects()).toMatchObject({
        saved: "saved_collections",
        want: "want_to_see_places",
        visits: "visits",
        fn: "record_on_site_visit(uuid,double precision,double precision,double precision,uuid)",
        // Three from the album migration, one from `collection_saves_for_curator` (collections
        // that were ever published, for the aggregate `app_collection_saves`).
        ownerPolicies: "4",
      });
    } finally {
      await owner.close(true);
    }
  });

  it("reverts the audit-role migration with a set_user_role entry present and applies it again", async () => {
    const owner = await MikroORM.init(createOrmConfig(db.urls.krajozbior_owner));
    const objects = () =>
      orm.em.execute<{
        find: string | null;
        setter: string | null;
        triggers: number;
        columns: number;
      }>(
        `select to_regprocedure('public.ops_find_user(text)')::text as find,
                to_regprocedure('public.ops_set_user_role(uuid, text)')::text as setter,
                (select count(*)::int from pg_trigger
                  where tgrelid = 'auth.users'::regclass and not tgisinternal) as triggers,
                (select count(*)::int from information_schema.columns
                  where table_name = 'operations_audit'
                    and column_name in ('recorded_by', 'transaction_id')) as columns`,
        [],
        "get",
      );

    try {
      // The append-only trigger keeps this entry through the revert, and the
      // old CHECK comes back NOT VALID, so it does not reject the entry.
      await orm.em.execute(
        `insert into public.operations_audit (operation, operator_label, outcome, reason)
         values ('set_user_role', 'migration-test', 'applied', 'powód')`,
      );
      await owner.migrator.down({ to: "Migration20261117150000_album" });
      expect(await objects()).toEqual({ find: null, setter: null, triggers: 0, columns: 0 });

      await owner.migrator.up();
      expect(await objects()).toEqual({
        find: "ops_find_user(text)",
        setter: "ops_set_user_role(uuid,text)",
        // The two role triggers and the deletion and last-member triggers of
        // E9-5 (the down above passes through those migrations too).
        triggers: 4,
        columns: 2,
      });
    } finally {
      await owner.close(true);
    }
  });

  it("reverts the account-deletion migration with a delete_account entry present and applies it again (E9-5)", async () => {
    const owner = await MikroORM.init(createOrmConfig(db.urls.krajozbior_owner));
    const objects = () =>
      orm.em.execute<Record<string, string | number | null>>(
        `select to_regprocedure('public.auth_users_audit_deletion()')::text as trigger_fn,
                to_regprocedure('public.operations_audit_delete_account_guard()')::text as guard_fn,
                to_regprocedure('public.app_is_sole_organization_member()')::text as sole_fn,
                (select count(*)::int from pg_trigger
                  where tgname in ('auth_users_deletion_audited', 'operations_audit_delete_account_guard')
                    and not tgisinternal) as triggers,
                (select with_check from pg_policies
                  where tablename = 'operations_audit' and policyname = 'operations_audit_ops_insert') as ops_check`,
        [],
        "get",
      );

    try {
      // The append-only trigger keeps this entry through the revert, and the
      // previous CHECK comes back NOT VALID, so it does not reject the entry.
      await orm.em.execute(
        `insert into public.operations_audit (operation, operator_label, subject_user_id, outcome, reason)
         values ('delete_account', 'migration-test', gen_random_uuid(), 'applied', 'account deleted')`,
      );
      await owner.migrator.down({ to: "Migration20261118130000_collection_slug_first_publish" });
      expect(await objects()).toEqual({
        trigger_fn: null,
        guard_fn: null,
        sole_fn: null,
        triggers: 0,
        ops_check: "true",
      });

      await owner.migrator.up();
      expect(await objects()).toEqual({
        trigger_fn: "auth_users_audit_deletion()",
        guard_fn: "operations_audit_delete_account_guard()",
        sole_fn: "app_is_sole_organization_member()",
        triggers: 2,
        ops_check: "(operation <> 'delete_account'::text)",
      });
    } finally {
      await owner.close(true);
    }
  });

  it("reverts everything and applies it again", async () => {
    const owner = await MikroORM.init(createOrmConfig(db.urls.krajozbior_owner));

    try {
      await owner.migrator.down({ to: 0 });
      expect((await catalogState(orm.em)).userFunction).toBeNull();

      await owner.migrator.up();
      expect((await catalogState(orm.em)).userFunction).toBe("app_current_user_id()");
    } finally {
      await owner.close(true);
    }
  });

  it("reverts the catalog import migration alone and applies it again", async () => {
    const owner = await MikroORM.init(createOrmConfig(db.urls.krajozbior_owner));
    const importState = () =>
      orm.em.execute<{ table: string | null; policies: number; delete: boolean }>(
        `select to_regclass('public.catalog_import_keys')::text as "table",
                (select count(*)::int from pg_policies
                  where tablename = 'places' and policyname = 'places_delete') as policies,
                has_table_privilege('krajozbior_app', 'public.places', 'delete') as "delete"`,
        [],
        "get",
      );

    try {
      expect(await importState()).toEqual({
        table: "catalog_import_keys",
        policies: 1,
        delete: true,
      });

      await owner.migrator.down({ to: "Migration20261118150000_last_member_guard" });
      expect(await importState()).toEqual({ table: null, policies: 0, delete: false });

      await owner.migrator.up();
      expect(await importState()).toEqual({
        table: "catalog_import_keys",
        policies: 1,
        delete: true,
      });
    } finally {
      await owner.close(true);
    }
  });

  it("writes and reads a technical record, then rolls it back", async () => {
    await orm.em.execute(`create table integration_technical_records (
      id text primary key,
      value text not null
    )`);

    try {
      const rollbackMarker = new Error("rollback integration transaction");

      await expect(
        orm.em.transactional(async (em) => {
          await em.execute(
            "insert into integration_technical_records (id, value) values (?, ?)",
            ["smoke-record", "written-and-read"],
            "run",
          );
          const record = await em.execute<{ id: string; value: string }>(
            "select id, value from integration_technical_records where id = ?",
            ["smoke-record"],
            "get",
          );

          expect(record).toEqual({ id: "smoke-record", value: "written-and-read" });
          throw rollbackMarker;
        }),
      ).rejects.toBe(rollbackMarker);

      const rows = await orm.em.execute<{ count: number }>(
        "select count(*)::int as count from integration_technical_records",
        [],
        "get",
      );

      expect(rows.count).toBe(0);
    } finally {
      await orm.em.execute("drop table if exists integration_technical_records");
    }
  });
});
