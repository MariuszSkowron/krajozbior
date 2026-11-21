import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  executeCatalogImport,
  executeCatalogRemove,
} from "@/features/catalog/application/catalog-import";
import {
  runCatalogImport,
  type CatalogImportCommandDeps,
  type ImportAuditGateway,
} from "@/features/catalog/application/catalog-import-command";
import type { CatalogImportDeps } from "@/features/catalog/application/catalog-import-types";
import { postgresCatalogImportRepository } from "@/features/catalog/infrastructure/postgres-catalog-import-repository";
import { createPostgresImportAudit } from "@/features/catalog/infrastructure/postgres-catalog-import-audit";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// F-K6: `catalog:import --target server` on a real database. The load runs as
// krajozbior_app in the context of the curator; the audit goes in as
// krajozbior_ops. Proves: two entries after a load, none after a preview or a
// refusal, no load when the audit cannot be written, and the database refuses
// the audit to every other role.
const publicFixture = readFileSync("tests/fixtures/curation/minimal-public.ndjson", "utf8");
const host = "krajozbior.pl";

let db: ScratchDatabase;
let appOrm: MikroORM;

const curator = { id: randomUUID(), role: "user" as const, email: "kurator-serwer@example.com" };
const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);
const ops$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(
    db.urls.krajozbior_ops,
    async (client) => (await client.query(sql, params)).rows as T[],
  );

const catalogDeps = (): CatalogImportDeps => ({
  catalog: {
    withUserContext: (actor, work) => runInUserContext(appOrm.em, actor, work),
    withGuestContext: (work) => runInGuestContext(appOrm.em, work),
    limiter: { reserve: async () => ({ allowed: true }) },
    repository: postgresCatalogRepository,
    random: (max) => randomInt(max),
  },
  imports: postgresCatalogImportRepository,
});

const closed = vi.fn(async () => undefined);

function serverDeps(audit: ImportAuditGateway = createPostgresImportAudit(db.urls.krajozbior_ops)) {
  const deps: CatalogImportCommandDeps = {
    readFile: async () => publicFixture,
    connect: async () => {
      throw new Error("the local connection must not be used in the server target");
    },
    server: {
      host,
      connect: async () => ({
        run: ({ file, orgSlug, preview, publish, remove }) =>
          remove
            ? executeCatalogRemove({ actor: curator, orgSlug, file }, catalogDeps())
            : executeCatalogImport(
                { actor: curator, orgSlug, file, preview, publish },
                catalogDeps(),
              ),
        close: closed,
      }),
      audit,
    },
  };

  return deps;
}

const flags = (extra: readonly string[] = [], confirm = host) => [
  "--file",
  "x",
  "--target",
  "server",
  "--confirm-host",
  confirm,
  "--profile",
  "public",
  "--org-slug",
  "gmina-serwer",
  "--curator-email",
  curator.email,
  ...extra,
];
const write = ["--operator", "Właściciel", "--reason", "Pierwsza fala"];

const auditRows = () =>
  admin$<{
    id: string;
    operation: string;
    outcome: string;
    error_code: string | null;
    operator_label: string;
    reason: string;
    recorded_by: string;
    organization_id: string | null;
    subject_user_id: string | null;
    details: Record<string, unknown>;
  }>(
    `select id, operation, outcome, error_code, operator_label, reason, recorded_by,
            organization_id, subject_user_id, details
       from public.operations_audit
      where operation in ('catalog_import', 'catalog_remove')
      order by occurred_at, id`,
  );
const collectionCount = async () =>
  (await admin$<{ n: number }>(`select count(*)::int as n from public.collections`))[0]!.n;

describe("catalog:import --target server on a real database", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_catalog_server");
    await db.migrate();
    await admin$(`insert into auth.users (id, name, email) values ($1, 'kurator', $2)`, [
      curator.id,
      curator.email,
    ]);

    const [{ id }] = await admin$<{ id: string }>(
      `insert into public.organizations (name, slug, kind) values ('Gmina serwer', 'gmina-serwer', 'municipality') returning id`,
    );

    await admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [id, curator.id],
    );
    appOrm = await MikroORM.init(createOrmConfig(db.urls.krajozbior_app));
  }, 60_000);

  afterAll(async () => {
    await appOrm?.close(true);
    await db?.drop();
  });

  it("without --target server the default connection still refuses production and a remote database", async () => {
    const { connectCatalogImport } =
      await import("@/features/catalog/infrastructure/catalog-import-runner");

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db.example.com:5432/x");
    vi.stubEnv("DATABASE_OPS_URL", "postgres://u:p@db.example.com:5432/x");

    try {
      await expect(connectCatalogImport()).rejects.toMatchObject({
        name: "UnsafeImportEnvironmentError",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses a wrong host, --publish and the full profile: nothing is loaded, no audit entry", async () => {
    const wrongHost = await runCatalogImport(flags(write, "example.com"), serverDeps());
    const publish = await runCatalogImport(flags([...write, "--publish"]), serverDeps());
    const full = await runCatalogImport(
      flags(write).map((value) => (value === "public" ? "full" : value)),
      serverDeps(),
    );

    expect([wrongHost.exitCode, publish.exitCode, full.exitCode]).toEqual([3, 3, 3]);
    expect(await collectionCount()).toBe(0);
    expect(await auditRows()).toEqual([]);
  });

  it("a preview needs the host and leaves no entry and no data", async () => {
    const result = await runCatalogImport(flags(["--dry-run"]), serverDeps());

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout[0]!)).toMatchObject({ outcome: "preview" });
    expect(await collectionCount()).toBe(0);
    expect(await auditRows()).toEqual([]);
  });

  it("no load when the audit cannot be written", async () => {
    const unreachable = createPostgresImportAudit("postgres://nobody:nothing@127.0.0.1:1/none");
    const result = await runCatalogImport(flags(write), serverDeps(unreachable));

    expect(result.exitCode).toBe(1);
    expect(result.stderr.join(" ")).toContain("nic nie wgrano");
    expect(await collectionCount()).toBe(0);
    expect(await auditRows()).toEqual([]);
  });

  it("no load when the database refuses the entry (the audit role is not allowed)", async () => {
    // krajozbior_app has no grant on the audit: the start entry fails, the load never starts.
    const asApp = createPostgresImportAudit(db.urls.krajozbior_app);
    const result = await runCatalogImport(flags(write), serverDeps(asApp));

    expect(result.exitCode).toBe(1);
    expect(await collectionCount()).toBe(0);
    expect(await auditRows()).toEqual([]);
  });

  it("a load leaves two entries: start before, result after, linked and without personal data", async () => {
    const result = await runCatalogImport(flags(write), serverDeps());

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout[0]!)).toMatchObject({ outcome: "applied" });
    expect(await collectionCount()).toBeGreaterThan(0);

    const rows = await auditRows();

    expect(rows).toHaveLength(2);

    const [start, finish] = rows as [(typeof rows)[number], (typeof rows)[number]];

    expect(start).toMatchObject({
      operation: "catalog_import",
      outcome: "applied",
      error_code: null,
      operator_label: "Właściciel",
      reason: "Pierwsza fala",
      recorded_by: "krajozbior_ops",
      subject_user_id: curator.id,
    });
    expect(start.organization_id).not.toBeNull();
    expect(start.details).toMatchObject({ phase: "start", profile: "public" });
    expect(start.details.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(finish).toMatchObject({
      operation: "catalog_import",
      outcome: "applied",
      recorded_by: "krajozbior_ops",
      organization_id: start.organization_id,
    });
    expect(finish.details).toMatchObject({
      phase: "finish",
      start_entry_id: start.id,
      batch_id: start.details.batch_id,
      file_sha256: start.details.file_sha256,
    });
    expect(finish.details.collection_results).toBeDefined();
    // The audit cannot be edited: no e-mail and no collection title may enter it.
    expect(JSON.stringify(rows)).not.toContain("@");
    expect(JSON.stringify(rows)).not.toContain("Kolekcja");
    // The detailed report is on the output only.
    expect(result.report).toBeUndefined();
  });

  it("a second load of the same file changes nothing but adds its own two entries", async () => {
    const before = await collectionCount();
    const result = await runCatalogImport(flags(write), serverDeps());

    expect(result.exitCode).toBe(0);
    expect(await collectionCount()).toBe(before);
    expect(await auditRows()).toHaveLength(4);
  });

  it("--remove on the server writes catalog_remove entries", async () => {
    const result = await runCatalogImport(flags([...write, "--remove"]), serverDeps());

    expect(result.exitCode).toBe(0);

    const rows = (await auditRows()).filter((row) => row.operation === "catalog_remove");

    expect(rows.map((row) => row.details.phase)).toEqual(["start", "finish"]);
  });

  it("records a refusal of the use case as a rejected entry", async () => {
    const result = await runCatalogImport(
      flags(write).map((value) => (value === "gmina-serwer" ? "gmina-nie-ma" : value)),
      serverDeps(),
    );

    expect(result.exitCode).toBe(3);

    const rows = await auditRows();
    const last = rows.at(-1)!;

    expect(last).toMatchObject({ outcome: "rejected", error_code: "import_refused" });
    expect(last.details).toMatchObject({ phase: "finish", refusal: "organization_unavailable" });
  });

  // Nested: one scratch database for both blocks (the revert test goes last).
  describe("the audit as the database protects it (F-K6)", () => {
    const insertEntry = (
      client: import("pg").Client,
      operation: string,
      details: unknown,
      code: string | null = null,
    ) =>
      client.query(
        `insert into public.operations_audit (operation, operator_label, outcome, reason, error_code, details)
       values ($1, 'op', $2, 'powód', $3, $4::jsonb)`,
        [operation, code === null ? "applied" : "rejected", code, JSON.stringify(details)],
      );

    it("has row security enabled, forced and policies; the application role stays safe", async () => {
      const gaps = await withClient(db.adminUrl, async (client) => [
        ...(await findRowLevelSecurityGaps(client, ["public.operations_audit"])),
        ...(await findApplicationRoleGaps(client)),
      ]);

      expect(gaps).toEqual([]);
    });

    it("gives krajozbior_ops the insert of the details column only, nobody else anything", async () => {
      const [p] = await admin$<Record<string, boolean>>(
        `select
         has_column_privilege('krajozbior_ops', 'public.operations_audit', 'details', 'insert') as ops_insert,
         has_column_privilege('krajozbior_ops', 'public.operations_audit', 'details', 'update') as ops_update,
         has_column_privilege('krajozbior_ops', 'public.operations_audit', 'details', 'select') as ops_select,
         has_table_privilege('krajozbior_ops', 'public.operations_audit', 'update, delete, truncate') as ops_bad,
         has_any_column_privilege('krajozbior_app', 'public.operations_audit', 'select, insert, update') as app_any,
         has_any_column_privilege('krajozbior_auth', 'public.operations_audit', 'select, insert, update') as auth_any,
         has_any_column_privilege('krajozbior_owner', 'public.operations_audit', 'update') as owner_update`,
      );

      expect(p).toEqual({
        ops_insert: true,
        ops_update: false,
        ops_select: false,
        ops_bad: false,
        app_any: false,
        auth_any: false,
        owner_update: false,
      });
    });

    it("krajozbior_app and krajozbior_owner cannot write the audit; ops cannot change or delete it", async () => {
      const entry = { phase: "start" };

      for (const role of ["krajozbior_app", "krajozbior_owner"] as const) {
        await withClient(db.urls[role], async (client) => {
          await expect(insertEntry(client, "catalog_import", entry)).rejects.toMatchObject({
            code: expect.stringMatching(/^42501$/),
          });
        });
      }

      await withClient(db.urls.krajozbior_ops, async (client) => {
        await expect(
          client.query(`update public.operations_audit set reason = 'x'`),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(client.query(`delete from public.operations_audit`)).rejects.toMatchObject({
          code: "42501",
        });
      });
    });

    it("details only for the two loader operations, only an object, at most 4000 characters", async () => {
      await withClient(db.urls.krajozbior_ops, async (client) => {
        for (const [operation, details] of [
          ["set_user_role", { a: 1 }],
          ["catalog_import", [1, 2]],
          ["catalog_import", { big: "x".repeat(4000) }],
        ] as const) {
          await expect(insertEntry(client, operation, details)).rejects.toMatchObject({
            code: "23514",
          });
        }

        await expect(insertEntry(client, "catalog_remove", { ok: true })).resolves.toBeDefined();
        await expect(
          insertEntry(client, "catalog_import", { phase: "finish" }, "import_failed"),
        ).resolves.toBeDefined();
      });
    });

    it("reverts the migration and applies it again", async () => {
      const owner = await MikroORM.init(createOrmConfig(db.urls.krajozbior_owner));
      const column = async () =>
        (
          await admin$<{ n: number }>(
            `select count(*)::int as n from information_schema.columns
            where table_name = 'operations_audit' and column_name = 'details'`,
          )
        )[0]!.n;

      try {
        await owner.migrator.down({ to: "Migration20261121100000_terms_acceptance" });
        expect(await column()).toBe(0);

        await owner.migrator.up();
        expect(await column()).toBe(1);
        // The ops role can write the new entries again after the round trip.
        await expect(
          ops$(
            `insert into public.operations_audit (operation, operator_label, outcome, reason, details)
           values ('catalog_import', 'op', 'applied', 'powód', '{"phase":"start"}')`,
          ),
        ).resolves.toBeDefined();
      } finally {
        await owner.close(true);
      }
    });
  });
});
