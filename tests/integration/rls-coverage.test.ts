import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// The proof behind the hook .claude/hooks/require-rls-in-migration.mjs: after
// ALL migrations, every ordinary or partitioned table (relkind r/p) outside
// the `auth` schema has row level security enabled AND forced AND at least one
// policy. The hook reads one file's text and can miss a spelling; this test
// reads the database catalog and misses nothing (docs/data-isolation.md).
//
// `auth` is exempt: starter_app and starter_ops have no privileges there at all
// (tested in auth-accounts-access.test.ts and database-roles.test.ts).
//
// ALLOWLIST: tables that are deliberately not protected by RLS. Every entry
// needs a reason; adding one is a security decision for the owner (this file
// is in CODEOWNERS).
const EXEMPT_SCHEMAS = ["auth"];
const ALLOWLIST: Record<string, string> = {
  // MikroORM's own bookkeeping; owned by starter_owner, no grants to the app.
  "public.mikro_orm_migrations": "migration bookkeeping, no application access",
};

// Materialized views have no row level security at all, so the application
// role must never be able to read one that holds user data: none may exist
// (any schema, `auth` included) unless it is listed here with a reason. Adding
// one is a security decision for the owner.
const MATERIALIZED_VIEW_ALLOWLIST: Record<string, string> = {};

type TableState = { table: string; enabled: boolean; forced: boolean; policies: number };

async function materializedViews(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `select n.nspname || '.' || c.relname as name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'm'
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname not like 'pg\\_%'
      order by 1`,
  );
  return rows.map(({ name }) => name).filter((name) => !(name in MATERIALIZED_VIEW_ALLOWLIST));
}

// Every relation in the `auth` schema (tables, partitions, views, materialized
// views, foreign tables), found in the catalog, not from a fixed list: the
// application role must hold no privilege on any of them, table or column.
async function applicationPrivilegesInAuth(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `select n.nspname || '.' || c.relname as name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth'
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (has_table_privilege('starter_app', c.oid,
               'select, insert, update, delete, truncate, references, trigger')
             or has_any_column_privilege('starter_app', c.oid,
               'select, insert, update, references'))
      order by 1`,
  );
  return rows.map(({ name }) => name);
}

async function tableStates(client: Client): Promise<TableState[]> {
  const { rows } = await client.query<TableState>(
    `select n.nspname || '.' || c.relname as "table",
            c.relrowsecurity as enabled,
            c.relforcerowsecurity as forced,
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname not like 'pg\\_%'
        and n.nspname <> all($1::text[])
      order by 1`,
    [EXEMPT_SCHEMAS],
  );
  return rows;
}

function gapsOf(tables: TableState[]): string[] {
  return tables
    .filter(({ table }) => !(table in ALLOWLIST))
    .flatMap(({ table, enabled, forced, policies }) => [
      ...(enabled ? [] : [`${table}: row level security is not enabled`]),
      ...(forced ? [] : [`${table}: row level security is not forced`]),
      ...(policies > 0 ? [] : [`${table}: no policies`]),
    ]);
}

let db: ScratchDatabase;

describe("row level security on every table after all migrations", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("starter_integration_rls_coverage");
    await db.migrate();
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("finds no table without enabled + forced RLS and a policy, apart from the allowlist", async () => {
    const tables = await withClient(db.adminUrl, tableStates);

    expect(gapsOf(tables)).toEqual([]);
    // The allowlist names only tables that exist: a stale entry hides nothing.
    for (const table of Object.keys(ALLOWLIST)) {
      expect(tables.map(({ table: name }) => name)).toContain(table);
    }
  });

  it("has no materialized view outside the allowlist, and would catch one", async () => {
    expect(await withClient(db.adminUrl, materializedViews)).toEqual([]);

    await withClient(db.adminUrl, async (client) => {
      await client.query(`create materialized view public.rls_probe_mv as select 1 as id`);
      try {
        expect(await materializedViews(client)).toEqual(["public.rls_probe_mv"]);
      } finally {
        await client.query(`drop materialized view public.rls_probe_mv`);
      }
    });
  });

  it("gives starter_app no privilege on any relation in the auth schema, and would catch one", async () => {
    expect(await withClient(db.adminUrl, applicationPrivilegesInAuth)).toEqual([]);

    await withClient(db.adminUrl, async (client) => {
      await client.query(`create table auth.rls_probe_privilege (id int, secret text)`);
      try {
        await client.query(`grant select (id) on auth.rls_probe_privilege to starter_app`);
        expect(await applicationPrivilegesInAuth(client)).toEqual(["auth.rls_probe_privilege"]);
        await client.query(`revoke select (id) on auth.rls_probe_privilege from starter_app`);
        expect(await applicationPrivilegesInAuth(client)).toEqual([]);
        await client.query(`grant delete on auth.rls_probe_privilege to starter_app`);
        expect(await applicationPrivilegesInAuth(client)).toEqual(["auth.rls_probe_privilege"]);
      } finally {
        await client.query(`drop table auth.rls_probe_privilege`);
      }
    });
  });

  it("would catch tables the hook could miss (quoted, unlogged, another schema, ENABLE only)", async () => {
    await withClient(db.adminUrl, async (client) => {
      await client.query(`create schema rls_probe_schema`);
      await client.query(`create unlogged table public."Rls_Probe" (id int)`);
      await client.query(`create table rls_probe_schema.notes (id int)`);
      await client.query(`create table public.rls_enabled_only (id int)`);
      await client.query(`alter table public.rls_enabled_only enable row level security`);
      await client.query(`create policy p on public.rls_enabled_only using (true)`);

      try {
        expect(gapsOf(await tableStates(client)).sort()).toEqual(
          [
            "public.Rls_Probe: row level security is not enabled",
            "public.Rls_Probe: row level security is not forced",
            "public.Rls_Probe: no policies",
            "public.rls_enabled_only: row level security is not forced",
            "rls_probe_schema.notes: row level security is not enabled",
            "rls_probe_schema.notes: row level security is not forced",
            "rls_probe_schema.notes: no policies",
          ].sort(),
        );
      } finally {
        await client.query(`drop table public."Rls_Probe", public.rls_enabled_only`);
        await client.query(`drop schema rls_probe_schema cascade`);
      }
    });
  });
});
