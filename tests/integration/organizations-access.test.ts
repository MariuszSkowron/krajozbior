import { randomUUID } from "node:crypto";

import { MikroORM, type EntityManager } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listMyOrganizations } from "@/features/organizations/application/list-my-organizations";
import { runOpsCurator } from "@/features/organizations/application/ops-curator-command";
import {
  ORGANIZATION_KINDS,
  ORGANIZATION_STATUSES,
} from "@/features/organizations/domain/organization";
import { connectOpsCurator } from "@/features/organizations/infrastructure/postgres-ops-curator";
import { listMyOrganizationsDeps } from "@/features/organizations/infrastructure/postgres-organization-reader";
import {
  demoOrganizations,
  assertDemoOrganizationsSeeded,
  seedDemoOrganizations,
} from "@/features/organizations/infrastructure/seed-demo-organizations";
import { createOrmConfig } from "@/lib/db/config";
import { AUDIT_ERROR_CODES, AUDIT_OPERATIONS } from "@/lib/db/operations-audit";
import { runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// E1, PR1: organizations, members, the audit and app_org_permission, proven on
// the real database. `app` is a pooled connection as krajozbior_app (max 1
// connection, so a leaked context would show); the operator command runs as
// krajozbior_owner like `npm run ops:curator`; the superuser connection only
// prepares accounts and reads the catalog.
const TABLES = ["public.organizations", "public.organization_members", "public.operations_audit"];

let db: ScratchDatabase;
let app: MikroORM;

const accounts = {
  ola: { id: randomUUID(), email: "ola@example.com" },
  ewa: { id: randomUUID(), email: "ewa@example.com" },
  jan: { id: randomUUID(), email: "jan@example.com" },
  kasia: { id: randomUUID(), email: "kasia@example.com" },
  olek: { id: randomUUID(), email: "olek@example.com" },
  zosia: { id: randomUUID(), email: "zosia@example.com" },
};
const demoA = { id: randomUUID(), email: "curator-a@demo.krajozbior.local" };
const demoB = { id: randomUUID(), email: "curator-b@demo.krajozbior.local" };

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);
const owner$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(
    db.urls.krajozbior_owner,
    async (client) => (await client.query(sql, params)).rows as T[],
  );
const as$ = (
  role: "krajozbior_app" | "krajozbior_auth" | "krajozbior_ops",
  sql: string,
  params: unknown[] = [],
) => withClient(db.urls[role], (client) => client.query(sql, params));

async function ops(...argv: string[]) {
  const output = await runOpsCurator([...argv, "--operator", "tester"], {
    getConnectionString: () => db.urls.krajozbior_owner,
    connect: connectOpsCurator,
  });

  return { ...output, json: output.stdout[0] ? JSON.parse(output.stdout[0]) : null };
}

const grant = (slug: string, email: string, ...extra: string[]) =>
  ops("grant", "--org-slug", slug, "--email", email, "--reason", "Wniosek", ...extra);
const create = ["--name", "Gmina Testowa", "--kind", "municipality"];

const auditCount = async () =>
  (await admin$<{ n: number }>(`select count(*)::int as n from public.operations_audit`))[0]!.n;
const lastAudit = async () =>
  (
    await admin$<Record<string, unknown>>(
      `select * from public.operations_audit order by occurred_at desc, id limit 1`,
    )
  )[0]!;

const permission = (em: EntityManager, organizationId: string) =>
  em.execute<{ p: string | null }>(`select app_org_permission(?) as p`, [organizationId], "get");
const orgId = async (slug: string) =>
  (await admin$<{ id: string }>(`select id from public.organizations where slug = $1`, [slug]))[0]!
    .id;

describe("organizations, membership and operator command", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_organizations");
    await db.migrate();

    for (const { id, email } of [...Object.values(accounts), demoA, demoB]) {
      await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
        id,
        email.split("@")[0],
        email,
      ]);
    }

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("has row security enabled, forced and policies on all three tables, and a safe app role", async () => {
    const gaps = await withClient(db.adminUrl, async (client) => [
      ...(await findRowLevelSecurityGaps(client, TABLES)),
      ...(await findApplicationRoleGaps(client)),
    ]);

    expect(gaps).toEqual([]);
  });

  it("gives exactly the intended privileges to every role", async () => {
    const [privileges] = await admin$<Record<string, boolean>>(
      `select
         has_table_privilege('krajozbior_app', 'organizations', 'select') as org_select,
         has_table_privilege('krajozbior_app', 'organizations', 'insert, update, delete, truncate, references, trigger') as org_write,
         has_table_privilege('krajozbior_app', 'organization_members', 'select') as mem_select,
         has_table_privilege('krajozbior_app', 'organization_members', 'insert, update, delete, truncate, references, trigger') as mem_write,
         has_any_column_privilege('krajozbior_app', 'organizations', 'insert, update') as org_column,
         has_any_column_privilege('krajozbior_app', 'organization_members', 'insert, update') as mem_column,
         has_table_privilege('krajozbior_app', 'operations_audit', 'select, insert, update, delete, truncate, references, trigger') as audit_app,
         has_any_column_privilege('krajozbior_app', 'operations_audit', 'select, insert, update') as audit_app_column,
         has_table_privilege('krajozbior_auth', 'operations_audit', 'select, insert, update, delete') as audit_auth,
         has_table_privilege('krajozbior_ops', 'operations_audit', 'select, insert, update, delete') as audit_ops,
         has_table_privilege('krajozbior_ops', 'organizations', 'select, insert, update, delete') as org_ops,
         has_table_privilege('krajozbior_auth', 'organization_members', 'select, insert, update, delete') as mem_auth,
         has_function_privilege('krajozbior_app', 'app_org_permission(uuid)', 'execute') as fn_app,
         has_function_privilege('krajozbior_ops', 'app_org_permission(uuid)', 'execute') as fn_ops,
         has_function_privilege('krajozbior_auth', 'app_org_permission(uuid)', 'execute') as fn_auth,
         (select coalesce(proacl::text, '') ~ '(^[{]|,)=X/' from pg_proc
           where oid = 'app_org_permission(uuid)'::regprocedure) as fn_public`,
    );

    expect(privileges).toEqual({
      org_select: true,
      org_write: false,
      mem_select: true,
      mem_write: false,
      org_column: false,
      mem_column: false,
      audit_app: false,
      audit_app_column: false,
      audit_auth: false,
      audit_ops: false,
      org_ops: false,
      mem_auth: false,
      fn_app: true,
      fn_ops: false,
      fn_auth: false,
      fn_public: false,
    });
  });

  it("refuses the application role every write and any read of the audit", async () => {
    const [{ id }] = await admin$<{ id: string }>(
      `insert into public.organizations (name, slug, kind) values ('Seed', 'seed-org', 'other') returning id`,
    );

    await expect(
      as$("krajozbior_app", `update public.organizations set name = 'x' where id = $1`, [id]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      as$("krajozbior_app", `delete from public.organizations where id = $1`, [id]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      as$("krajozbior_app", `select * from public.operations_audit`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("shows nothing about members and accepts no write without a user context", async () => {
    expect(await app.em.execute(`select * from public.organization_members`)).toEqual([]);
    expect(await permission(app.em, await orgId("seed-org"))).toEqual({ p: null });
    await expect(
      app.em.execute(
        `insert into public.organization_members (organization_id, user_id) values (?, ?)`,
        [await orgId("seed-org"), accounts.ola.id],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("does not let a plain account make itself a curator, even by raw SQL", async () => {
    const id = await orgId("seed-org");

    await expect(
      runInUserContext(app.em, accounts.ola, ({ em }) =>
        em.execute(
          `insert into public.organization_members (organization_id, user_id) values (?, ?)`,
          [id, accounts.ola.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runInUserContext(app.em, accounts.ola, ({ em }) =>
        em.execute(
          `insert into public.organizations (name, slug, kind) values ('x', 'own', 'person')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    expect(await permission(app.em, id)).toEqual({ p: null });
  });

  it("grants a new organization with the first member, writes an applied entry, and lists it", async () => {
    const before = await auditCount();
    const result = await grant("gmina-a", accounts.ola.email, ...create);

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      outcome: "applied",
      organizationSlug: "gmina-a",
      organizationCreated: true,
      userId: accounts.ola.id,
    });
    expect(result.stdout[0]).not.toContain("ola@example.com");
    expect(await auditCount()).toBe(before + 1);
    expect(await lastAudit()).toMatchObject({
      operation: "grant_curator",
      outcome: "applied",
      operator_label: "tester",
      subject_user_id: accounts.ola.id,
      error_code: null,
    });
    expect(JSON.stringify(await lastAudit())).not.toContain("ola@example.com");

    const listed = await listMyOrganizations(
      { id: accounts.ola.id, role: "user" },
      {
        withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
        listMemberships: listMyOrganizationsDeps.listMemberships,
      },
    );

    expect(listed).toEqual({
      status: "ok",
      organizations: [
        {
          id: await orgId("gmina-a"),
          name: "Gmina Testowa",
          slug: "gmina-a",
          kind: "municipality",
          status: "approved",
        },
      ],
    });
    expect(
      await listMyOrganizations(null, {
        withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
        listMemberships: listMyOrganizationsDeps.listMemberships,
      }),
    ).toEqual({ status: "unauthenticated" });
  });

  it("gives full_edit to a member of an approved organization and null to everyone else", async () => {
    const id = await orgId("gmina-a");

    expect(await runInUserContext(app.em, accounts.ola, ({ em }) => permission(em, id))).toEqual({
      p: "full_edit",
    });
    expect(await runInUserContext(app.em, accounts.ewa, ({ em }) => permission(em, id))).toEqual({
      p: null,
    });
    expect(await permission(app.em, id)).toEqual({ p: null });
    expect(
      await runInUserContext(app.em, accounts.ola, ({ em }) => permission(em, randomUUID())),
    ).toEqual({ p: null });
  });

  it("hides the membership of one account from another", async () => {
    const asEwa = await runInUserContext(app.em, accounts.ewa, ({ em }) =>
      em.execute(`select * from public.organization_members`),
    );
    const asOla = await runInUserContext(app.em, accounts.ola, ({ em }) =>
      em.execute<{ user_id: string }[]>(`select user_id from public.organization_members`),
    );

    expect(asEwa).toEqual([]);
    expect(asOla).toEqual([{ user_id: accounts.ola.id }]);
  });

  it("repeats grant as noop without a new entry, and refuses a second grant with another kind", async () => {
    const before = await auditCount();
    const again = await grant("gmina-a", accounts.ola.email);
    const mismatch = await grant("gmina-a", accounts.ewa.email, "--name", "Inna", "--kind", "pttk");

    expect(again).toMatchObject({ exitCode: 0, json: { outcome: "noop" } });
    expect(mismatch).toMatchObject({
      exitCode: 3,
      json: { outcome: "rejected", code: "kind_mismatch" },
    });
    expect(await auditCount()).toBe(before + 1);
    expect(await lastAudit()).toMatchObject({
      outcome: "rejected",
      error_code: "kind_mismatch",
      subject_user_id: accounts.ewa.id,
      organization_id: await orgId("gmina-a"),
      before_state: null,
    });
  });

  it("refuses an unknown e-mail, writes a rejected entry and does not create an account", async () => {
    const users = async () =>
      (await admin$<{ n: number }>(`select count(*)::int as n from auth.users`))[0]!.n;
    const usersBefore = await users();
    const result = await grant("gmina-nowa", "nobody@example.com", ...create);

    expect(result).toMatchObject({
      exitCode: 3,
      json: { outcome: "rejected", code: "user_not_found" },
    });
    expect(await users()).toBe(usersBefore);
    expect(
      (await admin$(`select 1 from public.organizations where slug = 'gmina-nowa'`)).length,
    ).toBe(0);
    expect(await lastAudit()).toMatchObject({
      outcome: "rejected",
      error_code: "user_not_found",
      subject_user_id: null,
      organization_id: null,
      after_state: { organizationSlug: "gmina-nowa" },
    });
    expect(JSON.stringify(await lastAudit())).not.toContain("nobody@example.com");
  });

  it("needs --name and --kind for a new organization: exit 2 with a rejected entry", async () => {
    const result = await grant("bez-szczegolow", accounts.ewa.email);

    expect(result).toMatchObject({
      exitCode: 2,
      json: { outcome: "rejected", code: "organization_details_required" },
    });
    expect(await lastAudit()).toMatchObject({ error_code: "organization_details_required" });
  });

  it("leaves no entry for a bad argument or a missing reason or operator (exit 2)", async () => {
    const before = await auditCount();
    const noReason = await runOpsCurator(
      ["grant", "--org-slug", "gmina-a", "--email", accounts.ewa.email, "--operator", "tester"],
      { getConnectionString: () => db.urls.krajozbior_owner, connect: connectOpsCurator },
    );
    const badSlug = await grant("Zly Slug", accounts.ewa.email);
    const noOperator = await runOpsCurator(["suspend", "--org-slug", "gmina-a", "--reason", "x"], {
      getConnectionString: () => db.urls.krajozbior_owner,
      connect: connectOpsCurator,
    });

    expect([noReason.exitCode, badSlug.exitCode, noOperator.exitCode]).toEqual([2, 2, 2]);
    expect(await auditCount()).toBe(before);
  });

  it("allows one member for kind person and refuses the second, but repeats the first as noop", async () => {
    const person = ["--name", "Jan Kowalski", "--kind", "person"];

    expect((await grant("jan-kowalski", accounts.jan.email, ...person)).json.outcome).toBe(
      "applied",
    );

    const second = await grant("jan-kowalski", accounts.kasia.email);
    const again = await grant("jan-kowalski", accounts.jan.email);

    expect(second).toMatchObject({ exitCode: 3, json: { code: "person_member_limit" } });
    expect(again.json.outcome).toBe("noop");
    expect(
      (
        await admin$<{ n: number }>(
          `select count(*)::int as n from public.organization_members where organization_id = $1`,
          [await orgId("jan-kowalski")],
        )
      )[0]!.n,
    ).toBe(1);
  });

  it("makes two parallel first grants for one slug end without a unique violation", async () => {
    const results = await Promise.all([
      grant("rownolegle", accounts.ewa.email, ...create),
      grant("rownolegle", accounts.kasia.email, ...create),
    ]);

    expect(results.map((result) => result.exitCode)).toEqual([0, 0]);
    expect(results.map((result) => result.json.outcome)).toEqual(["applied", "applied"]);
    expect(results.filter((result) => result.json.organizationCreated).length).toBe(1);
    expect(
      (
        await admin$<{ n: number }>(
          `select count(*)::int as n from public.organizations where slug = 'rownolegle'`,
        )
      )[0]!.n,
    ).toBe(1);
  });

  it("lets only one of two parallel grants into an existing empty person organization", async () => {
    const slug = "osoba-rownolegle";

    await grant(slug, accounts.ewa.email, "--name", "Osoba Rownolegla", "--kind", "person");
    await ops("revoke", "--org-slug", slug, "--email", accounts.ewa.email, "--reason", "Koniec");

    const results = await Promise.all([
      grant(slug, accounts.olek.email),
      grant(slug, accounts.zosia.email),
    ]);

    expect(results.map((result) => result.exitCode).sort()).toEqual([0, 3]);
    expect(results.filter((result) => result.json.outcome === "applied").length).toBe(1);
    expect(results.filter((result) => result.json.code === "person_member_limit").length).toBe(1);
    expect(
      (
        await admin$<{ n: number }>(
          `select count(*)::int as n from public.organization_members where organization_id = $1`,
          [await orgId(slug)],
        )
      )[0]!.n,
    ).toBe(1);
    expect(
      (
        await admin$<{ n: number }>(
          `select count(*)::int as n from public.operations_audit
           where organization_id = $1 and outcome = 'rejected' and error_code = 'person_member_limit'`,
          [await orgId(slug)],
        )
      )[0]!.n,
    ).toBe(1);
  });

  it("revokes a membership once and repeats revoke as noop", async () => {
    const revoke = () =>
      ops(
        "revoke",
        "--org-slug",
        "rownolegle",
        "--email",
        accounts.kasia.email,
        "--reason",
        "Koniec",
      );
    const first = await revoke();
    const second = await revoke();
    const unknownOrg = await ops(
      "revoke",
      "--org-slug",
      "nie-ma",
      "--email",
      accounts.kasia.email,
      "--reason",
      "x",
    );

    expect(first.json.outcome).toBe("applied");
    expect(second.json.outcome).toBe("noop");
    expect(unknownOrg).toMatchObject({ exitCode: 3, json: { code: "organization_not_found" } });
    expect(
      await runInUserContext(app.em, accounts.kasia, async ({ em }) =>
        permission(em, await orgId("rownolegle")),
      ),
    ).toEqual({ p: null });
  });

  it("suspends and approves an organization: app_org_permission follows, a noop leaves no entry", async () => {
    const id = await orgId("gmina-a");
    const status = (verb: string) => ops(verb, "--org-slug", "gmina-a", "--reason", "Kontrola");
    const before = await auditCount();
    const suspended = await status("suspend");
    const again = await status("suspend");

    expect(suspended.json).toMatchObject({ outcome: "applied", status: "suspended" });
    expect(again.json.outcome).toBe("noop");
    expect(await auditCount()).toBe(before + 1);
    expect(await lastAudit()).toMatchObject({
      operation: "set_organization_status",
      before_state: { status: "approved" },
      after_state: { status: "suspended" },
    });

    // A suspended organization: null for its member, visible only to the member.
    expect(await runInUserContext(app.em, accounts.ola, ({ em }) => permission(em, id))).toEqual({
      p: null,
    });
    const visible = (actor: { id: string } | null) =>
      actor === null
        ? app.em.execute<{ slug: string }[]>(
            `select slug from public.organizations where slug = 'gmina-a'`,
          )
        : runInUserContext(app.em, actor, ({ em }) =>
            em.execute<{ slug: string }[]>(
              `select slug from public.organizations where slug = 'gmina-a'`,
            ),
          );

    expect(await visible(accounts.ola)).toEqual([{ slug: "gmina-a" }]);
    expect(await visible(accounts.ewa)).toEqual([]);
    expect(await visible(null)).toEqual([]);
    expect(
      (
        await runInUserContext(app.em, accounts.ola, (tx) =>
          listMyOrganizationsDeps.listMemberships(tx),
        )
      )[0]?.status,
    ).toBe("suspended");

    expect((await status("approve")).json.outcome).toBe("applied");
    expect(await runInUserContext(app.em, accounts.ola, ({ em }) => permission(em, id))).toEqual({
      p: "full_edit",
    });
    expect((await ops("suspend", "--org-slug", "nie-ma", "--reason", "x")).json).toMatchObject({
      code: "organization_not_found",
    });
  });

  it("keeps the audit append-only: no UPDATE, DELETE or TRUNCATE for any role", async () => {
    const { id } = (await lastAudit()) as { id: string };

    // The owner has no UPDATE/DELETE policy: the statement changes no row.
    expect(
      (
        await owner$(`update public.operations_audit set reason = 'x' where id = $1 returning id`, [
          id,
        ])
      ).length,
    ).toBe(0);
    expect(
      (await owner$(`delete from public.operations_audit where id = $1 returning id`, [id])).length,
    ).toBe(0);
    // A role that skips policies still meets the trigger.
    await expect(
      admin$(`update public.operations_audit set reason = 'x' where id = $1`, [id]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      admin$(`delete from public.operations_audit where id = $1`, [id]),
    ).rejects.toMatchObject({
      code: "55000",
    });
    await expect(owner$(`truncate public.operations_audit`)).rejects.toMatchObject({
      code: "55000",
    });
    await expect(admin$(`truncate public.operations_audit`)).rejects.toMatchObject({
      code: "55000",
    });
  });

  it("enforces the audit CHECKs: outcome and error code agree, labels and reasons are clean", async () => {
    const insert = (outcome: string, code: string | null, label = "tester", reason = "powód") =>
      owner$(
        `insert into public.operations_audit (operation, operator_label, outcome, reason, error_code)
         values ('grant_curator', $1, $2, $3, $4)`,
        [label, outcome, reason, code],
      );

    await expect(insert("rejected", null)).rejects.toMatchObject({ code: "23514" });
    await expect(insert("applied", "user_not_found")).rejects.toMatchObject({ code: "23514" });
    await expect(insert("rejected", "made_up")).rejects.toMatchObject({ code: "23514" });
    await expect(insert("applied", null, "a\nb")).rejects.toMatchObject({ code: "23514" });
    await expect(insert("applied", null, "ok", "")).rejects.toMatchObject({ code: "23514" });
    await expect(insert("applied", null, "x".repeat(81))).rejects.toMatchObject({ code: "23514" });
    await expect(insert("applied", null, "ok", "x".repeat(401))).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("keeps the frozen CHECK lists in step with the code", async () => {
    const listOf = async (table: string, column: string) => {
      const rows = await admin$<{ def: string }>(
        `select pg_get_constraintdef(c.oid) as def
           from pg_constraint c
          where c.conrelid = $1::regclass and c.contype = 'c'`,
        [table],
      );
      const found = rows.find(({ def }) => def.includes(`(${column} = ANY`));

      return [...(found?.def.matchAll(/'([a-z_]+)'::text/g) ?? [])].map((match) => match[1]);
    };

    expect(await listOf("public.organizations", "kind")).toEqual([...ORGANIZATION_KINDS]);
    expect(await listOf("public.organizations", "status")).toEqual([...ORGANIZATION_STATUSES]);
    expect(await listOf("public.operations_audit", "operation")).toEqual([...AUDIT_OPERATIONS]);
    expect(await listOf("public.operations_audit", "error_code")).toEqual([...AUDIT_ERROR_CODES]);
    expect(await listOf("public.operations_audit", "outcome")).toEqual(["applied", "rejected"]);
  });

  it("seeds the demo organizations idempotently: two runs give the same rows", async () => {
    const snapshot = () =>
      admin$(
        `select o.slug, o.name, o.kind, o.status, m.user_id
           from public.organizations o
           join public.organization_members m on m.organization_id = o.id
          where o.slug like 'demo-%' order by o.slug`,
      );

    const first = await seedDemoOrganizations(db.urls.krajozbior_owner);
    const rows = await snapshot();
    const second = await seedDemoOrganizations(db.urls.krajozbior_owner);

    expect(first.map((result) => result.outcome)).toEqual(["applied", "applied"]);
    expect(second.map((result) => result.outcome)).toEqual(["noop", "noop"]);
    expect(await snapshot()).toEqual(rows);
    expect(rows).toEqual(
      demoOrganizations.map(({ slug, name, kind }, index) => ({
        slug,
        name,
        kind,
        status: "approved",
        user_id: [demoA, demoB][index]!.id,
      })),
    );
    // Curator A sees only the own organization's permission, never B's.
    const idB = await orgId("demo-pttk-b");

    expect(await runInUserContext(app.em, demoA, ({ em }) => permission(em, idB))).toEqual({
      p: null,
    });
    expect(await runInUserContext(app.em, demoB, ({ em }) => permission(em, idB))).toEqual({
      p: "full_edit",
    });
  });

  it("fails the demo seed when a curator grant is refused", () => {
    expect(() =>
      assertDemoOrganizationsSeeded([
        { outcome: "applied", organizationSlug: "gmina-a" },
        { outcome: "rejected", code: "user_not_found", organizationSlug: "pttk-b" },
      ]),
    ).toThrow(/pttk-b \(user_not_found\)/);
    expect(() =>
      assertDemoOrganizationsSeeded([
        { outcome: "applied", organizationSlug: "gmina-a" },
        { outcome: "noop", organizationSlug: "pttk-b" },
      ]),
    ).not.toThrow();
  });

  it("does not carry a user context to the next transaction on the same connection", async () => {
    const pid = (em: EntityManager) =>
      em.execute<{ pid: number }>("select pg_backend_pid() as pid", [], "get");
    const inside = await runInUserContext(app.em, accounts.ola, ({ em }) => pid(em));
    const after = await app.em.transactional((em) => pid(em));

    expect(after.pid).toBe(inside.pid);
    expect(await app.em.execute(`select app_current_user_id() as "userId"`, [], "get")).toEqual({
      userId: null,
    });
    expect(await app.em.execute(`select * from public.organization_members`)).toEqual([]);
  });

  it("has no infinite recursion of policies on any path", async () => {
    for (const actor of [null, accounts.ola, accounts.ewa]) {
      const run = (em: EntityManager) =>
        em.execute(
          `select o.slug, m.user_id, app_org_permission(o.id)
             from public.organizations o left join public.organization_members m on m.organization_id = o.id`,
        );

      await expect(
        actor === null ? run(app.em) : runInUserContext(app.em, actor, ({ em }) => run(em)),
      ).resolves.toBeDefined();
    }
  });
});
