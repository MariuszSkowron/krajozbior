import { randomBytes } from "node:crypto";

import { Pool, type Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifiedPool } from "@/features/identity/infrastructure/better-auth";
import { initApplicationOrm, UnsafeDatabaseRoleError } from "@/lib/db/client";
import { createOrmConfig } from "@/lib/db/config";

import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps } from "../support/rls-guard";

// Proves the role boundary of issue #21 through real LOGIN connections:
// krajozbior_app never reaches `auth`, krajozbior_auth reaches nothing else, and no role
// can skip row policies. The superuser connection only reads the catalog.
let db: ScratchDatabase;

const permissionDenied = { code: "42501" };

const publicCanCreateInPublicSchema = async () => {
  const { rows } = await withClient(db.adminUrl, (client) =>
    client.query<{ allowed: boolean }>(
      `select exists (
         select from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
          where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'CREATE'
       ) as allowed`,
    ),
  );

  return rows[0]?.allowed;
};

const runtimeRoleCanCreateInPublicSchema = async () => {
  const { rows } = await withClient(db.adminUrl, (client) =>
    client.query<{ rolname: string }>(
      `select rolname from pg_roles
        where rolname in ('krajozbior_app', 'krajozbior_auth', 'krajozbior_ops')
          and has_schema_privilege(oid, 'public', 'CREATE')`,
    ),
  );

  return rows.map((row) => row.rolname);
};

// A LOGIN role that is not one of krajozbior_*, prepared by `setup` from the
// superuser connection and dropped afterwards (roles are global to the cluster).
const withTemporaryRole = async <T>(
  setup: string[],
  work: (url: string) => Promise<T>,
): Promise<T> => {
  const role = "guard_test_role";
  const password = randomBytes(24).toString("base64url");
  const url = new URL(db.adminUrl);

  url.username = role;
  url.password = password;
  await withClient(db.adminUrl, async (client) => {
    await client.query(`drop owned by ${role} cascade`).catch(() => undefined);
    await client.query(`drop role if exists ${role}`);
    await client.query(`create role ${role} login noinherit password '${password}'`);
    for (const sql of setup) {
      await client.query(sql.replaceAll("$role", role));
    }
  });
  try {
    return await work(url.toString());
  } finally {
    await withClient(db.adminUrl, async (client) => {
      await client.query(`drop owned by ${role} cascade`);
      await client.query(`drop role ${role}`);
    });
  }
};

const expectRefused = async (url: string) => {
  await expect(initApplicationOrm(createOrmConfig(url))).rejects.toBeInstanceOf(
    UnsafeDatabaseRoleError,
  );

  const pool = new Pool({ connectionString: url, max: 1 });

  try {
    await expect(verifiedPool(pool)()).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
  } finally {
    await pool.end();
  }
};

const asRole = <T>(role: keyof ScratchDatabase["urls"], work: (client: Client) => Promise<T>) =>
  withClient(db.urls[role], work);

describe("database roles", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_roles");
    await db.migrate();
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("creates login roles that cannot create roles, skip RLS or inherit privileges", async () => {
    const { rows } = await withClient(db.adminUrl, (client) =>
      client.query(
        `select rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb
           from pg_roles where rolname like 'krajozbior\\_%' and rolname <> current_user
          order by rolname`,
      ),
    );

    expect(rows).toEqual(
      ["krajozbior_app", "krajozbior_auth", "krajozbior_ops", "krajozbior_owner"].map(
        (rolname) => ({
          rolname,
          rolcanlogin: true,
          rolsuper: false,
          rolbypassrls: false,
          rolinherit: false,
          rolcreaterole: false,
          rolcreatedb: false,
        }),
      ),
    );
  });

  it("leaves the application role nothing that skips row policies, also after a repeated run", async () => {
    await db.provisionRoles();

    expect(await withClient(db.adminUrl, findApplicationRoleGaps)).toEqual([]);
  });

  it("gives krajozbior_app no access to the auth schema", async () => {
    await asRole("krajozbior_app", async (client) => {
      expect((await client.query("select current_user as role")).rows).toEqual([
        { role: "krajozbior_app" },
      ]);
      for (const table of ["users", "sessions", "accounts", "verifications", "sign_in_throttle"]) {
        await expect(client.query(`select * from auth.${table} limit 1`)).rejects.toMatchObject(
          permissionDenied,
        );
      }
      await expect(
        client.query(`insert into auth.users (name, email) values ('x', 'x@example.test')`),
      ).rejects.toMatchObject(permissionDenied);
    });
  });

  it("lets krajozbior_app read the user context but not create objects", async () => {
    await asRole("krajozbior_app", async (client) => {
      expect((await client.query(`select app_current_user_id() as "userId"`)).rows).toEqual([
        { userId: null },
      ]);
      await expect(client.query("create table public.app_owned (id int)")).rejects.toMatchObject(
        permissionDenied,
      );
    });
  });

  it("takes CREATE on the public schema away from PUBLIC, also after a manual grant", async () => {
    await withClient(db.adminUrl, (client) =>
      client.query("grant create on schema public to public"),
    );
    expect(await publicCanCreateInPublicSchema()).toBe(true);

    await db.provisionRoles();

    expect(await publicCanCreateInPublicSchema()).toBe(false);
  });

  it("takes CREATE on the public schema away from the runtime roles, also after a manual grant", async () => {
    await withClient(db.adminUrl, (client) =>
      client.query(
        "grant create on schema public to krajozbior_app, krajozbior_auth, krajozbior_ops",
      ),
    );
    expect(await runtimeRoleCanCreateInPublicSchema()).toHaveLength(3);

    await db.provisionRoles();

    expect(await runtimeRoleCanCreateInPublicSchema()).toEqual([]);
  });

  it("refuses to start the application or the auth pool as a superuser", async () => {
    const failure = initApplicationOrm(createOrmConfig(db.adminUrl));

    await expect(failure).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
    await expect(failure).rejects.toThrow(
      /^Database role must not be privileged, own objects, belong to roles or switch roles$/,
    );
    await expectRefused(db.adminUrl);
  });

  it("refuses a role with BYPASSRLS that is not a superuser", async () => {
    await withTemporaryRole(["alter role $role bypassrls"], expectRefused);
  });

  it("refuses a role that owns a table and could turn row level security off", async () => {
    await withTemporaryRole(
      [
        "create table public.guard_test_owned (id int)",
        "alter table public.guard_test_owned owner to $role",
      ],
      expectRefused,
    );
  });

  it("refuses a role that belongs to another role and could switch to it", async () => {
    await withTemporaryRole(["grant krajozbior_ops to $role"], expectRefused);
  });

  it("refuses a privileged login that switched to krajozbior_app", async () => {
    const url = new URL(db.adminUrl);

    url.searchParams.set("options", "-c role=krajozbior_app");

    const pool = new Pool({ connectionString: url.toString(), max: 1 });

    try {
      expect((await pool.query("select current_user as role")).rows).toEqual([
        { role: "krajozbior_app" },
      ]);
      await expect(verifiedPool(pool)()).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
    } finally {
      await pool.end();
    }
  });

  it("starts the application as krajozbior_app and the auth pool as krajozbior_auth", async () => {
    const orm = await initApplicationOrm(createOrmConfig(db.urls.krajozbior_app));

    await orm.close(true);

    const pool = new Pool({ connectionString: db.urls.krajozbior_auth, max: 1 });

    try {
      await expect(verifiedPool(pool)()).resolves.toBe(pool);
    } finally {
      await pool.end();
    }
  });

  it("limits krajozbior_auth to the auth schema", async () => {
    await asRole("krajozbior_auth", async (client) => {
      expect((await client.query("select count(*)::int as count from auth.users")).rows).toEqual([
        { count: 0 },
      ]);
      expect(
        (await client.query("select count(*)::int as count from auth.sign_in_throttle")).rows,
      ).toEqual([{ count: 0 }]);
      await expect(client.query("select app_current_user_id()")).rejects.toMatchObject(
        permissionDenied,
      );
      await expect(client.query("create table public.auth_owned (id int)")).rejects.toMatchObject(
        permissionDenied,
      );
      await expect(client.query("select * from public.mikro_orm_migrations")).rejects.toMatchObject(
        permissionDenied,
      );
    });
  });

  it("gives krajozbior_auth no privilege on public tables and no ops_* function", async () => {
    const { rows } = await withClient(db.adminUrl, (client) =>
      client.query<{ object: string }>(
        `select c.oid::regclass::text as object
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and (has_table_privilege('krajozbior_auth', c.oid,
                   'select, insert, update, delete, truncate, references, trigger')
                 or has_any_column_privilege('krajozbior_auth', c.oid, 'select, insert, update'))
         union all
         select p.oid::regprocedure::text
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'ops\_%'
            and has_function_privilege('krajozbior_auth', p.oid, 'execute')`,
      ),
    );

    // No ops_* function of the application schema is executable by krajozbior_auth.
    expect(rows).toEqual([]);
  });

  it("gives krajozbior_ops no access to the auth schema or the migrations table", async () => {
    await asRole("krajozbior_ops", async (client) => {
      await expect(client.query("select * from auth.users")).rejects.toMatchObject(
        permissionDenied,
      );
      await expect(client.query("select * from auth.sign_in_throttle")).rejects.toMatchObject(
        permissionDenied,
      );
      await expect(client.query("select * from public.mikro_orm_migrations")).rejects.toMatchObject(
        permissionDenied,
      );
    });
  });
});
