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
