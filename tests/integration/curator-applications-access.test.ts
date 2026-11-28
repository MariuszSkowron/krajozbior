import { randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  CuratorApplicationsDeps,
  MyCuratorApplication,
} from "@/features/curator-applications/application/curator-application-types";
import {
  decideCuratorApplication,
  getMyCuratorApplication,
  listCuratorApplications,
  revokeCuratorRole,
  submitCuratorApplication,
  withdrawCuratorApplication,
} from "@/features/curator-applications/application/curator-applications";
import { postgresCuratorApplicationsRepository } from "@/features/curator-applications/infrastructure/postgres-curator-applications";
import { ORGANIZATION_KINDS } from "@/features/organizations/domain/organization";
import { createOrmConfig } from "@/lib/db/config";
import { runInAdminContext, runInUserContext } from "@/lib/db/user-context";

import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// P7/P8 (spec "Rola kuratora", section 6; D-59): applications for the curator role and the
// three functions of the administrator, proven on the real database. `app` is a pooled
// connection as krajozbior_app (max 1 connection, so a leaked context would show); raw
// transactions on krajozbior_app prove what the database itself refuses; the superuser
// connection only prepares fixtures and reads the catalog.
//
// The guarantee under test (and its weakening, D-59): a plain account never becomes a curator.
// The functions need the role `admin` AND the token of a live session of that account.
let db: ScratchDatabase;
let app: MikroORM;

const denied = { code: "42501" };

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);
const as$ = (
  role: "krajozbior_app" | "krajozbior_auth" | "krajozbior_ops" | "krajozbior_owner",
  sql: string,
  params: unknown[] = [],
) => withClient(db.urls[role], (client) => client.query(sql, params));

type Account = { id: string; email: string };

// The superuser prepares an administrator: the role trigger is switched off for the update, the
// same trail the operator command leaves is not the subject of this test.
async function newAccount(role: "user" | "admin" = "user"): Promise<Account> {
  const id = randomUUID();
  const email = `${id}@example.com`;

  await withClient(db.adminUrl, async (client) => {
    await client.query(`insert into auth.users (id, name, email) values ($1, 'x', $2)`, [
      id,
      email,
    ]);
    if (role === "admin") {
      await client.query(`alter table auth.users disable trigger auth_users_role_audited_update`);
      await client.query(`update auth.users set role = 'admin' where id = $1`, [id]);
      await client.query(`alter table auth.users enable trigger auth_users_role_audited_update`);
    }
  });

  return { id, email };
}

// A session as Better Auth writes it (krajozbior_auth); `createdHoursAgo` moves `created_at`.
async function newSession(
  account: Account,
  {
    expiresInHours = 1,
    createdHoursAgo = 0,
  }: { expiresInHours?: number; createdHoursAgo?: number } = {},
): Promise<string> {
  const token = `token-${randomUUID()}`;

  await as$(
    "krajozbior_auth",
    `insert into auth.sessions (user_id, token, expires_at, created_at)
     values ($1, $2, now() + make_interval(hours => $3::int), now() - make_interval(hours => $4::int))`,
    [account.id, token, expiresInHours, createdHoursAgo],
  );

  return token;
}

// One transaction on krajozbior_app with the context the application would set; rolled back
// unless `commit`. A statement that fails aborts the transaction, so one refusal per call.
async function inApp<T>(
  context: { user?: string; token?: string; gate?: boolean },
  work: (client: Client) => Promise<T>,
  commit = false,
): Promise<T> {
  return withClient(db.urls.krajozbior_app, async (client) => {
    await client.query("begin");
    try {
      if (context.user !== undefined) {
        await client.query(`select set_config('app.user_id', $1, true)`, [context.user]);
      }
      if (context.token !== undefined) {
        await client.query(`select set_config('app.session_token', $1, true)`, [context.token]);
      }
      if (context.gate === true) {
        await client.query(`select set_config('krajozbior.curator_panel_write', 'on', true)`);
      }
      const result = await work(client);

      await client.query(commit ? "commit" : "rollback");

      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

const form = {
  organizationName: "Gmina Testowa",
  organizationKind: "municipality",
  applicantRole: "promocja",
  contact: "promocja@example.com",
  websiteUrl: null,
};

const insertSql = `insert into public.curator_applications
  (organization_name, organization_kind, applicant_role, contact)
  values ($1, $2, 'rola', 'kontakt@example.com') returning id`;

// The way the application makes the row: krajozbior_app in the context of the applicant.
async function submit(account: Account, kind = "municipality", name = "Gmina Testowa") {
  return inApp(
    { user: account.id },
    async (client) => (await client.query(insertSql, [name, kind])).rows[0].id as string,
    true,
  );
}

const deps: CuratorApplicationsDeps = {
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  withAdminContext: (actor, token, work) => runInAdminContext(app.em, actor, token, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresCuratorApplicationsRepository,
  panelEnabled: () => true,
};

const asUser = (account: Account) => ({ id: account.id, role: "user" as const });
const sessionOf = (account: Account, token: string) => ({
  actor: { id: account.id, role: "admin" as const },
  sessionToken: token,
});

// Everything the three functions may change, for "nothing was written" checks.
async function snapshot() {
  const [counts] = await admin$<Record<string, number>>(
    `select (select count(*)::int from public.organizations) as organizations,
            (select count(*)::int from public.organization_members) as members,
            (select count(*)::int from public.operations_audit
              where operation in ('grant_curator', 'revoke_curator')) as audit`,
  );
  const applications = await admin$(
    `select id, status, decided_at, decided_by, rejection_reason, organization_id
       from public.curator_applications order by id`,
  );

  return { counts, applications };
}

const decideSql = `select * from public.app_admin_decide_curator_application($1, $2, $3, $4, $5, $6)`;
const approveNew = (id: string, name: string, slug: string) => [
  id,
  "approve",
  null,
  name,
  slug,
  null,
];

let admin: Account;
let adminToken: string;

describe("curator applications: access, administrator functions, session and gate", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_curator_applications");
    await db.migrate();

    admin = await newAccount("admin");
    adminToken = await newSession(admin);

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  describe("catalog, privileges and frozen lists", () => {
    it("has row security enabled, forced, with policies, and a safe app role", async () => {
      const gaps = await withClient(db.adminUrl, async (client) => [
        ...(await findRowLevelSecurityGaps(client, ["public.curator_applications"])),
        ...(await findApplicationRoleGaps(client)),
      ]);

      expect(gaps).toEqual([]);
    });

    it("gives krajozbior_app exactly select, delete and insert on five columns", async () => {
      const [privileges] = await admin$<Record<string, boolean>>(
        `select
           has_table_privilege('krajozbior_app', 'curator_applications', 'select') as sel,
           has_table_privilege('krajozbior_app', 'curator_applications', 'delete') as del,
           has_table_privilege('krajozbior_app', 'curator_applications', 'insert') as insert_table,
           has_any_column_privilege('krajozbior_app', 'curator_applications', 'update') as update_any,
           has_table_privilege('krajozbior_app', 'curator_applications', 'truncate, references, trigger') as other,
           has_column_privilege('krajozbior_app', 'curator_applications', 'organization_name', 'insert')
             and has_column_privilege('krajozbior_app', 'curator_applications', 'organization_kind', 'insert')
             and has_column_privilege('krajozbior_app', 'curator_applications', 'applicant_role', 'insert')
             and has_column_privilege('krajozbior_app', 'curator_applications', 'contact', 'insert')
             and has_column_privilege('krajozbior_app', 'curator_applications', 'website_url', 'insert') as five,
           (select bool_or(has_column_privilege('krajozbior_app', 'curator_applications', a.attname, 'insert'))
              from pg_attribute a
             where a.attrelid = 'public.curator_applications'::regclass and a.attnum > 0
               and not a.attisdropped
               and a.attname in ('id', 'applicant_user_id', 'status', 'created_at', 'decided_at',
                                 'decided_by', 'rejection_reason', 'organization_id')) as protected,
           has_table_privilege('krajozbior_auth', 'curator_applications', 'select, insert, update, delete') as auth,
           has_table_privilege('krajozbior_ops', 'curator_applications', 'select, insert, update, delete') as ops`,
      );

      expect(privileges).toEqual({
        sel: true,
        del: true,
        insert_table: false,
        update_any: false,
        other: false,
        five: true,
        protected: false,
        auth: false,
        ops: false,
      });
    });

    it("lets only krajozbior_app execute the three functions and only the owner the helper", async () => {
      const [execute] = await admin$<Record<string, boolean>>(
        `select
           bool_and(has_function_privilege('krajozbior_app', f, 'execute')) as app_three,
           bool_or(has_function_privilege('krajozbior_ops', f, 'execute')
                or has_function_privilege('krajozbior_auth', f, 'execute')) as others_three,
           bool_or((select coalesce(proacl::text, '') ~ '(^[{]|,)=X/' from pg_proc
                     where oid = f::regprocedure)) as public_three,
           has_function_privilege('krajozbior_app', 'app_require_live_admin()', 'execute') as app_helper,
           has_function_privilege('krajozbior_owner', 'app_require_live_admin()', 'execute') as owner_helper
         from unnest(array[
           'app_admin_curator_applications(text)',
           'app_admin_decide_curator_application(uuid, text, uuid, text, text, text)',
           'app_admin_revoke_curator(uuid, text)'
         ]) as f`,
      );

      expect(execute).toEqual({
        app_three: true,
        others_three: false,
        public_three: false,
        app_helper: false,
        owner_helper: true,
      });
      await expect(
        inApp({ user: admin.id, token: adminToken }, (client) =>
          client.query(`select public.app_require_live_admin()`),
        ),
      ).rejects.toMatchObject(denied);
    });

    it("keeps the frozen list of organization kinds equal to the code", async () => {
      const [{ definition }] = await admin$<{ definition: string }>(
        `select pg_get_constraintdef(c.oid) as definition from pg_constraint c
          where c.conrelid = 'public.curator_applications'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) like '%organization_kind%'`,
      );
      const kinds = [...definition.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

      expect([...kinds].sort()).toEqual([...ORGANIZATION_KINDS].sort());
    });

    it("limits the audit policy of the panel to the two operations", async () => {
      const [policy] = await admin$<{ with_check: string }>(
        `select with_check from pg_policies
          where tablename = 'operations_audit' and policyname = 'operations_audit_panel_insert'`,
      );

      expect(policy!.with_check).toContain("grant_curator");
      expect(policy!.with_check).toContain("revoke_curator");
      expect(policy!.with_check).not.toContain("set_user_role");
      expect(policy!.with_check).not.toContain("news_import");
      expect(policy!.with_check).toContain("krajozbior_app");
    });
  });

  describe("the applicant's own row", () => {
    it("shows nothing and accepts no insert without a user context", async () => {
      const rows = await inApp(
        {},
        async (client) => (await client.query(`select * from public.curator_applications`)).rows,
      );

      expect(rows).toEqual([]);
      // Row security (42501) or the NOT NULL of the owner column (23502): either way, no row.
      await expect(
        inApp({}, (client) => client.query(insertSql, ["Gmina", "municipality"])),
      ).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23502)$/) });
    });

    it("keeps the application of A from B: no read, no delete, no write of the owner column", async () => {
      const a = await newAccount();
      const b = await newAccount();
      const id = await submit(a);

      expect(
        await inApp(
          { user: b.id },
          async (client) =>
            (await client.query(`select * from public.curator_applications where id = $1`, [id]))
              .rows,
        ),
      ).toEqual([]);
      expect(
        await inApp(
          { user: b.id },
          async (client) =>
            (await client.query(`delete from public.curator_applications where id = $1`, [id]))
              .rowCount,
        ),
      ).toBe(0);
      await expect(
        inApp({ user: b.id }, (client) =>
          client.query(
            `insert into public.curator_applications
               (applicant_user_id, organization_name, organization_kind, applicant_role, contact)
             values ($1, 'x', 'other', 'r', 'kontakt')`,
            [a.id],
          ),
        ),
      ).rejects.toMatchObject(denied);
      await expect(
        inApp({ user: a.id }, (client) =>
          client.query(`update public.curator_applications set status = 'approved' where id = $1`, [
            id,
          ]),
        ),
      ).rejects.toMatchObject(denied);
      await expect(
        inApp({ user: a.id }, (client) =>
          client.query(
            `update public.curator_applications set contact = 'inny kontakt' where id = $1`,
            [id],
          ),
        ),
      ).rejects.toMatchObject(denied);
    });

    it("allows one pending application per account (23505) and at most 20 rows (42501)", async () => {
      const a = await newAccount();

      await submit(a);
      await expect(submit(a)).rejects.toMatchObject({ code: "23505" });

      const b = await newAccount();

      await admin$(
        `insert into public.curator_applications
           (applicant_user_id, organization_name, organization_kind, applicant_role, contact,
            status, decided_at, rejection_reason)
         select $1, 'Gmina ' || n, 'other', 'rola', 'kontakt', 'rejected', now(), 'powód'
           from generate_series(1, 20) as n`,
        [b.id],
      );
      await expect(submit(b)).rejects.toMatchObject(denied);
    });

    it("counts only the rows of the caller (app_my_curator_application_count)", async () => {
      const a = await newAccount();
      const b = await newAccount();
      const countFor = (context: { user?: string }) =>
        inApp(context, async (client) =>
          Number(
            (await client.query(`select public.app_my_curator_application_count() as n`)).rows[0].n,
          ),
        );

      await submit(a);
      await admin$(
        `insert into public.curator_applications
           (applicant_user_id, organization_name, organization_kind, applicant_role, contact,
            status, decided_at, rejection_reason)
         select $1, 'Gmina ' || n, 'other', 'rola', 'kontakt', 'rejected', now(), 'powód'
           from generate_series(1, 20) as n`,
        [b.id],
      );

      // Twenty rows of another account do not count for the caller; without a context: zero.
      expect(await countFor({ user: a.id })).toBe(1);
      expect(await countFor({ user: b.id })).toBe(20);
      expect(await countFor({})).toBe(0);

      const [{ others }] = await admin$<{ others: boolean }>(
        `select bool_or(has_function_privilege(r, 'app_my_curator_application_count()', 'execute'))
                  as others
           from unnest(array['krajozbior_auth', 'krajozbior_ops']) as r`,
      );

      expect(others).toBe(false);
    });

    it("lets the applicant remove a pending or rejected row but never an approved one", async () => {
      const a = await newAccount();
      const del = (user: Account, id: string) =>
        inApp(
          { user: user.id },
          async (client) =>
            (
              await client.query(
                `delete from public.curator_applications where id = $1 returning id`,
                [id],
              )
            ).rowCount,
        );
      const [{ id: organizationId }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ('Org A', $1, 'other') returning id`,
        [`org-${randomUUID().slice(0, 8)}`],
      );
      const [rejected, approved] = await admin$<{ id: string }>(
        `insert into public.curator_applications
           (applicant_user_id, organization_name, organization_kind, applicant_role, contact,
            status, decided_at, rejection_reason, organization_id)
         values
           ($1, 'R', 'other', 'r', 'kontakt', 'rejected', now(), 'powód', null),
           ($1, 'A', 'other', 'r', 'kontakt', 'approved', now(), null, $2)
         returning id`,
        [a.id, organizationId],
      );

      expect(await del(a, rejected!.id)).toBe(1);
      expect(await del(a, approved!.id)).toBe(0);

      const pending = await newAccount();
      const pendingId = await submit(pending);

      expect(await del(pending, pendingId)).toBe(1);
    });

    it("answers already_decided when the delete waited for an approval in another transaction", async () => {
      const applicant = await newAccount();

      await submit(applicant);

      const [{ id }] = await admin$<{ id: string }>(
        `select id from public.curator_applications where applicant_user_id = $1`,
        [applicant.id],
      );
      const holder = new Client({ connectionString: db.urls.krajozbior_app });

      await holder.connect();
      try {
        await holder.query("begin");
        await holder.query(`select set_config('app.user_id', $1, true)`, [admin.id]);
        await holder.query(`select set_config('app.session_token', $1, true)`, [adminToken]);
        await holder.query(decideSql, approveNew(id, "Gmina Wyścig", "gmina-wyscig"));

        const waiting = withdrawCuratorApplication(asUser(applicant), deps);

        await new Promise((resolve) => setTimeout(resolve, 500));
        await holder.query("commit");

        expect(await waiting).toEqual({ status: "conflict", code: "already_decided" });
      } finally {
        await holder.end();
      }

      const [after] = await admin$<{ status: string }>(
        `select status from public.curator_applications where id = $1`,
        [id],
      );

      expect(after!.status).toBe("approved");
    });
  });

  describe("the live session of the administrator (W1)", () => {
    it("refuses every function without a live session of an administrator, and writes nothing", async () => {
      const applicant = await newAccount();
      const id = await submit(applicant);
      const otherAdmin = await newAccount("admin");
      const otherToken = await newSession(otherAdmin);
      const expired = await newSession(admin, { expiresInHours: -1 });
      const tooOld = await newSession(admin, { expiresInHours: 5, createdHoursAgo: 13 });
      const loggedOut = await newSession(admin);

      await as$("krajozbior_auth", `delete from auth.sessions where token = $1`, [loggedOut]);

      const plain = await newAccount();
      const plainToken = await newSession(plain);
      const before = await snapshot();
      const contexts: [string, { user?: string; token?: string }][] = [
        ["no context", {}],
        ["identifier without a token", { user: admin.id }],
        ["a token without an identifier", { token: adminToken }],
        ["the token of another administrator", { user: admin.id, token: otherToken }],
        ["an expired session", { user: admin.id, token: expired }],
        ["a session older than 12 hours", { user: admin.id, token: tooOld }],
        ["a session that was logged out", { user: admin.id, token: loggedOut }],
        ["a plain account with its own live token", { user: plain.id, token: plainToken }],
        [
          "the applicant with a token of the administrator",
          { user: applicant.id, token: adminToken },
        ],
      ];

      for (const [label, context] of contexts) {
        for (const statement of [
          [`select * from public.app_admin_curator_applications('pending')`, []],
          [decideSql, approveNew(id, "Gmina Sesja", `gmina-sesja-${randomUUID().slice(0, 6)}`)],
          [`select * from public.app_admin_revoke_curator($1, 'powód')`, [id]],
        ] as [string, unknown[]][]) {
          await expect(
            inApp(context, (client) => client.query(statement[0], statement[1])),
            `${label}: ${statement[0]}`,
          ).rejects.toMatchObject(denied);
        }
      }

      expect(await snapshot()).toEqual(before);
    });

    it("works with the token of the own live session", async () => {
      const applicant = await newAccount();
      const id = await submit(applicant);
      const result = await listCuratorApplications(sessionOf(admin, adminToken), "pending", deps);

      expect(result.status).toBe("ok");
      expect(
        result.status === "ok" && result.value.some((application) => application.id === id),
      ).toBe(true);
    });

    it("maps the refusal to `unauthenticated` in the use case and leaks no token", async () => {
      const applicant = await newAccount();
      const id = await submit(applicant);

      expect(
        await decideCuratorApplication(
          sessionOf(admin, "not-a-live-token"),
          id,
          { decision: "reject", reason: "Test" },
          deps,
        ),
      ).toEqual({ status: "unauthenticated" });
      expect(
        await revokeCuratorRole(sessionOf(admin, "not-a-live-token"), id, { reason: "Test" }, deps),
      ).toEqual({ status: "unauthenticated" });
      expect(
        await listCuratorApplications(sessionOf(admin, "not-a-live-token"), "pending", deps),
      ).toEqual({ status: "unauthenticated" });
    });

    it("does not carry the context to the next transaction on the same connection", async () => {
      await listCuratorApplications(sessionOf(admin, adminToken), "pending", deps);

      const [leak] = await app.em.execute<
        { user: string | null; token: string | null; gate: string | null }[]
      >(
        `select nullif(current_setting('app.user_id', true), '') as "user",
                nullif(current_setting('app.session_token', true), '') as token,
                nullif(current_setting('krajozbior.curator_panel_write', true), '') as gate`,
      );

      expect(leak).toMatchObject({ user: null, token: null, gate: null });
    });
  });

  describe("the use cases refuse the other roles before the database", () => {
    it("answers 401-like and 403-like results for a guest, a user and a curator", async () => {
      const plain = await newAccount();
      const id = await submit(plain);
      const userSession = { actor: asUser(plain), sessionToken: "x" };

      expect(await listCuratorApplications(null, "pending", deps)).toEqual({
        status: "unauthenticated",
      });
      expect(await listCuratorApplications(userSession, "pending", deps)).toEqual({
        status: "forbidden",
      });
      expect(
        await decideCuratorApplication(userSession, id, { decision: "reject", reason: "x" }, deps),
      ).toEqual({ status: "forbidden" });
      expect(await submitCuratorApplication(null, form, deps)).toEqual({
        status: "unauthenticated",
      });
      // An administrator does not apply (the role check comes first).
      expect(await submitCuratorApplication({ id: admin.id, role: "admin" }, form, deps)).toEqual({
        status: "forbidden",
      });
    });

    it("does not let an explorer approve his own application, by any route", async () => {
      const applicant = await newAccount();
      const id = await submit(applicant);
      const token = await newSession(applicant);
      const before = await snapshot();

      await expect(
        inApp({ user: applicant.id, token }, (client) =>
          client.query(decideSql, approveNew(id, "Moja Gmina", "moja-gmina")),
        ),
      ).rejects.toMatchObject(denied);
      expect(
        await decideCuratorApplication(
          { actor: asUser(applicant), sessionToken: token },
          id,
          { decision: "approve", organizationName: "Moja Gmina", organizationSlug: "moja-gmina" },
          deps,
        ),
      ).toEqual({ status: "forbidden" });
      expect(await snapshot()).toEqual(before);
    });

    it("keeps the panel switch in front of everything", async () => {
      const off = { ...deps, panelEnabled: () => false };

      expect(await listCuratorApplications(sessionOf(admin, adminToken), "pending", off)).toEqual({
        status: "not_found",
      });
    });
  });

  describe("approve, reject and refusals", () => {
    it("approves into a new organization in one transaction, with one audit entry", async () => {
      const applicant = await newAccount();
      const id = await submit(applicant);
      const before = await snapshot();
      const result = await decideCuratorApplication(
        sessionOf(admin, adminToken),
        id,
        {
          decision: "approve",
          organizationName: "  Gmina Rumia ",
          organizationSlug: "gmina-rumia",
        },
        deps,
      );

      expect(result.status).toBe("ok");

      const [organization] = await admin$<{
        id: string;
        name: string;
        kind: string;
        status: string;
      }>(`select id, name, kind, status from public.organizations where slug = 'gmina-rumia'`);

      expect(organization).toMatchObject({
        name: "Gmina Rumia",
        kind: "municipality",
        status: "approved",
      });
      expect(
        await admin$(
          `select 1 from public.organization_members where organization_id = $1 and user_id = $2`,
          [organization!.id, applicant.id],
        ),
      ).toHaveLength(1);

      const audit = await admin$<Record<string, unknown>>(
        `select * from public.operations_audit
          where operation = 'grant_curator' and subject_user_id = $1`,
        [applicant.id],
      );

      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        outcome: "applied",
        error_code: null,
        organization_id: organization!.id,
        recorded_by: "krajozbior_app",
        operator_label: "panel administratora",
        reason: "Wniosek o status kuratora",
        before_state: { member: false },
        after_state: {
          member: true,
          organizationSlug: "gmina-rumia",
          organizationKind: "municipality",
          organizationCreated: true,
          applicationId: id,
          adminUserId: admin.id,
        },
      });
      expect(audit[0]!.transaction_id).not.toBeNull();

      const [application] = await admin$<Record<string, unknown>>(
        `select status, decided_by, organization_id, rejection_reason, decided_at is not null as decided
           from public.curator_applications where id = $1`,
        [id],
      );

      expect(application).toMatchObject({
        status: "approved",
        decided_by: admin.id,
        organization_id: organization!.id,
        rejection_reason: null,
        decided: true,
      });

      const after = await snapshot();

      expect(after.counts).toEqual({
        organizations: before.counts.organizations! + 1,
        members: before.counts.members! + 1,
        audit: before.counts.audit! + 1,
      });

      // The applicant now has the membership, through his own policy.
      expect(
        await runInUserContext(app.em, { id: applicant.id }, ({ em }) =>
          em.execute(`select organization_id from public.organization_members`),
        ),
      ).toHaveLength(1);
    });

    it("turns the write switch off before the function returns (S1)", async () => {
      const applicant = await newAccount();
      const id = await submit(applicant);

      await inApp({ user: admin.id, token: adminToken }, async (client) => {
        await client.query(decideSql, approveNew(id, "Gmina Bramka", "gmina-bramka"));

        const { rows } = await client.query(
          `select current_setting('krajozbior.curator_panel_write', true) as gate`,
        );

        expect(rows[0].gate).toBe("off");
        await expect(
          client.query(
            `insert into public.organizations (name, slug, kind) values ('x', 'x-bramka', 'other')`,
          ),
        ).rejects.toMatchObject(denied);
      });
    });

    it("turns the write switch off after a refusal as well", async () => {
      await inApp({ user: admin.id, token: adminToken }, async (client) => {
        await client.query(decideSql, [randomUUID(), "reject", null, null, null, "Powód"]);

        const { rows } = await client.query(
          `select current_setting('krajozbior.curator_panel_write', true) as gate`,
        );

        expect(rows[0].gate).toBe("off");
      });
    });

    it("refuses with a code and writes nothing: slug_taken, kind, organization with curators, role, state", async () => {
      await admin$(
        `insert into public.organizations (name, slug, kind, status) values
           ('Zajęta', 'zajeta', 'municipality', 'approved'),
           ('Zawieszona', 'zawieszona', 'municipality', 'suspended')`,
      );

      const [{ id: otherKind }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ('Inna', 'inna-org', 'other') returning id`,
      );
      const [{ id: suspended }] = await admin$<{ id: string }>(
        `select id from public.organizations where slug = 'zawieszona'`,
      );
      const [{ id: personOrg }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ('Przewodnik Jan', 'przewodnik-jan', 'person') returning id`,
      );
      const member = await newAccount();

      await admin$(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [personOrg, member.id],
      );

      const decide = async (applicationId: string, body: Record<string, unknown>) =>
        decideCuratorApplication(sessionOf(admin, adminToken), applicationId, body, deps);
      const newOrg = (slug: string) => ({
        decision: "approve",
        organizationName: "Nazwa",
        organizationSlug: slug,
      });
      const existing = (organizationId: string) => ({ decision: "approve", organizationId });

      const slugApplication = await submit(await newAccount());
      const suspendedSlugApplication = await submit(await newAccount());
      const kindApplication = await submit(await newAccount());
      const suspendedApplication = await submit(await newAccount());
      const unknownApplication = await submit(await newAccount());
      const personApplication = await submit(await newAccount(), "person", "Przewodnik Ewa");
      const adminApplicant = await newAccount();
      const adminApplication = await submit(adminApplicant);

      await withClient(db.adminUrl, async (client) => {
        await client.query(`alter table auth.users disable trigger auth_users_role_audited_update`);
        await client.query(`update auth.users set role = 'admin' where id = $1`, [
          adminApplicant.id,
        ]);
        await client.query(`alter table auth.users enable trigger auth_users_role_audited_update`);
      });

      const before = await snapshot();
      const cases: [string, Record<string, unknown>, string][] = [
        [slugApplication, newOrg("zajeta"), "slug_taken"],
        [suspendedSlugApplication, newOrg("zawieszona"), "slug_taken"],
        [kindApplication, existing(otherKind), "kind_mismatch"],
        [suspendedApplication, existing(suspended), "organization_not_found"],
        [unknownApplication, existing(randomUUID()), "organization_not_found"],
        [personApplication, existing(personOrg), "organization_exists"],
        [adminApplication, newOrg("gmina-admina"), "admin_cannot_be_member"],
      ];

      for (const [applicationId, body, code] of cases) {
        expect(await decide(applicationId, body), code).toEqual({ status: "conflict", code });
      }

      expect(await snapshot()).toEqual(before);
      expect(await decide(randomUUID(), newOrg("nigdzie"))).toEqual({ status: "not_found" });
    });

    // C-05: invisible characters (Cf) and look-alike letters of another script in the name.
    const badNames: [string, string][] = [
      ["zero-width space", "Gmina​Testowa"],
      ["right-to-left override", "Gmina ‮atsetoT"],
      ["language tag", "Gmina\u{e0041}Testowa"],
      ["Cyrillic a", "Gminа Testowa"],
      ["Greek omicron", "Gmina Testοwa"],
      ["combining mark", "Gmina Testowá"],
    ];

    it("refuses invisible characters and look-alike letters in the name, in the table and in the function (C-05)", async () => {
      const someone = await newAccount();

      for (const [label, name] of badNames) {
        await expect(
          inApp({ user: someone.id }, (client) => client.query(insertSql, [name, "municipality"])),
          label,
        ).rejects.toMatchObject({ code: "23514" });
      }

      // The allowed set still goes through.
      await expect(
        inApp({ user: someone.id }, (client) =>
          client.query(insertSql, ["Koło PTTK nr 5 (Rumia), o'Neil & Co.-1", "pttk"]),
        ),
      ).resolves.toBeDefined();

      const id = await submit(await newAccount());
      const before = await snapshot();

      for (const [label, name] of badNames) {
        await expect(
          inApp({ user: admin.id, token: adminToken }, (client) =>
            client.query(decideSql, approveNew(id, name, "nazwa-c05")),
          ),
          label,
        ).rejects.toMatchObject({ code: "22023" });
      }

      expect(await snapshot()).toEqual(before);
    });

    it("refuses a second decision with not_pending", async () => {
      const id = await submit(await newAccount());
      const session = sessionOf(admin, adminToken);

      expect(
        await decideCuratorApplication(
          session,
          id,
          { decision: "reject", reason: "Nie znamy" },
          deps,
        ),
      ).toMatchObject({ status: "ok" });
      expect(
        await decideCuratorApplication(
          session,
          id,
          { decision: "approve", organizationName: "Późno", organizationSlug: "pozno" },
          deps,
        ),
      ).toEqual({ status: "conflict", code: "not_pending" });
    });

    it("rejects only with a reason, which the applicant reads, and writes no audit entry", async () => {
      const applicant = await newAccount();
      const id = await submit(applicant);
      const before = await snapshot();

      await expect(
        inApp({ user: admin.id, token: adminToken }, (client) =>
          client.query(decideSql, [id, "reject", null, null, null, null]),
        ),
      ).rejects.toMatchObject({ code: "22023" });
      expect(
        await decideCuratorApplication(
          sessionOf(admin, adminToken),
          id,
          { decision: "reject", reason: "   " },
          deps,
        ),
      ).toEqual({ status: "invalid" });
      expect(await snapshot()).toEqual(before);

      expect(
        await decideCuratorApplication(
          sessionOf(admin, adminToken),
          id,
          { decision: "reject", reason: "Nie znamy tej organizacji." },
          deps,
        ),
      ).toMatchObject({ status: "ok" });

      const view = await getMyCuratorApplication(asUser(applicant), deps);

      expect(view).toMatchObject({
        status: "ok",
        value: {
          state: "rejected",
          application: { rejectionReason: "Nie znamy tej organizacji." },
        },
      });
      expect((await snapshot()).counts).toEqual(before.counts);
    });

    it("refuses every existing organization, with or without members, also for its own member (D-62 point 1)", async () => {
      const [{ id: organizationId }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ('Stała', 'stala-org', 'other') returning id`,
      );
      const [{ id: emptyOrganizationId }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ('Pusta', 'pusta-org', 'other') returning id`,
      );
      const curator = await newAccount();
      const stranger = await newAccount();

      await admin$(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [organizationId, curator.id],
      );

      const ownMemberApplication = await submit(curator, "other", "Stała");
      const strangerApplication = await submit(stranger, "other", "Stała");
      const before = await snapshot();
      const session = sessionOf(admin, adminToken);

      for (const id of [ownMemberApplication, strangerApplication]) {
        expect(
          await decideCuratorApplication(
            session,
            id,
            { decision: "approve", organizationId },
            deps,
          ),
        ).toEqual({ status: "conflict", code: "organization_exists" });
      }
      // The same through the function of the database: a refusal, nothing written.
      expect(
        await inApp({ user: admin.id, token: adminToken }, async (client) =>
          (
            await client.query(decideSql, [
              strangerApplication,
              "approve",
              organizationId,
              null,
              null,
              null,
            ])
          ).rows.map((row) => [row.outcome, row.code]),
        ),
      ).toEqual([["refused", "organization_exists"]]);
      expect(await snapshot()).toEqual(before);

      // The application stays pending, and the administrator can reject it with an explanation.
      expect(
        await decideCuratorApplication(
          session,
          strangerApplication,
          { decision: "reject", reason: "Dołącz przez kuratora tej organizacji." },
          deps,
        ),
      ).toMatchObject({ status: "ok" });

      // An existing organization without any member is refused too (D-62 point 1): re-admission
      // is the job of the operator (`ops:curator`), not of the panel. Nothing is written.
      const emptyApplication = await submit(await newAccount(), "other", "Pusta");
      const beforeEmpty = await snapshot();

      expect(
        await decideCuratorApplication(
          session,
          emptyApplication,
          { decision: "approve", organizationId: emptyOrganizationId },
          deps,
        ),
      ).toEqual({ status: "conflict", code: "organization_exists" });
      expect(await snapshot()).toEqual(beforeEmpty);
    });
  });

  describe("revoking the role and the newest application of a pair (S3)", () => {
    it("marks only the newest approved application of a pair and refuses an older one", async () => {
      const applicant = await newAccount();
      const first = await submit(applicant);
      const session = sessionOf(admin, adminToken);

      expect(
        await decideCuratorApplication(
          session,
          first,
          { decision: "approve", organizationName: "Para", organizationSlug: "para-org" },
          deps,
        ),
      ).toMatchObject({ status: "ok" });

      const [{ organization_id: organizationId }] = await admin$<{ organization_id: string }>(
        `select organization_id from public.curator_applications where id = $1`,
        [first],
      );
      // D-62 point 1: the panel takes nobody into an existing organization, so the pair appears
      // only through the operator (`ops:curator`), simulated here: the role is taken, the panel
      // refuses the second application, then the operator re-admits the person and the second
      // application is marked approved directly. The pair is built by hand (raw SQL below) as a
      // simulation of what the operator does, because the panel no longer creates such a pair.
      expect(
        await revokeCuratorRole(session, first, { reason: "Przerwa we współpracy" }, deps),
      ).toMatchObject({ status: "ok" });

      const second = await submit(applicant);

      expect(
        await decideCuratorApplication(
          session,
          second,
          { decision: "approve", organizationId },
          deps,
        ),
      ).toEqual({ status: "conflict", code: "organization_exists" });

      await admin$(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [organizationId, applicant.id],
      );
      await admin$(
        `update public.curator_applications
            set status = 'approved', decided_at = now(), decided_by = $2, organization_id = $3
          where id = $1`,
        [second, admin.id, organizationId],
      );

      const listed = await listCuratorApplications(session, "approved", deps);
      const ours =
        listed.status === "ok"
          ? listed.value.filter((application) => application.organizationId === organizationId)
          : [];

      expect(ours.map((application) => [application.id, application.applicantIsMember])).toEqual(
        expect.arrayContaining([
          [first, false],
          [second, true],
        ]),
      );

      const before = await snapshot();

      expect(await revokeCuratorRole(session, first, { reason: "Koniec" }, deps)).toEqual({
        status: "conflict",
        code: "not_member",
      });
      expect(await snapshot()).toEqual(before);

      expect(
        await revokeCuratorRole(session, second, { reason: "Koniec współpracy" }, deps),
      ).toMatchObject({
        status: "ok",
      });
      expect(
        await admin$(`select 1 from public.organization_members where organization_id = $1`, [
          organizationId,
        ]),
      ).toHaveLength(0);

      const [audit] = await admin$<Record<string, unknown>>(
        `select * from public.operations_audit
          where operation = 'revoke_curator' and subject_user_id = $1 and reason = $2`,
        [applicant.id, "Koniec współpracy"],
      );

      expect(audit).toMatchObject({
        outcome: "applied",
        recorded_by: "krajozbior_app",
        reason: "Koniec współpracy",
        before_state: { member: true, organizationSlug: "para-org", applicationId: second },
        after_state: { member: false, adminUserId: admin.id },
      });

      // The application stays approved (history); a second revocation finds no member.
      expect(await revokeCuratorRole(session, second, { reason: "Jeszcze raz" }, deps)).toEqual({
        status: "conflict",
        code: "not_member",
      });

      const view = await getMyCuratorApplication(asUser(applicant), deps);

      expect(view).toMatchObject({ status: "ok", value: { state: "approved_revoked" } });
    });

    it("refuses a reason with an address or without text, and a pending or unknown application", async () => {
      const session = sessionOf(admin, adminToken);
      const pending = await submit(await newAccount());

      for (const reason of ["Napisał jan@example.com", "", "   "]) {
        expect(await revokeCuratorRole(session, pending, { reason }, deps)).toEqual({
          status: "invalid",
        });
      }
      await expect(
        inApp({ user: admin.id, token: adminToken }, (client) =>
          client.query(
            `select * from public.app_admin_revoke_curator($1, 'Napisał jan@example.com')`,
            [pending],
          ),
        ),
      ).rejects.toMatchObject({ code: "22023" });
      expect(await revokeCuratorRole(session, pending, { reason: "Test" }, deps)).toEqual({
        status: "conflict",
        code: "not_member",
      });
      expect(await revokeCuratorRole(session, randomUUID(), { reason: "Test" }, deps)).toEqual({
        status: "not_found",
      });
    });
  });

  describe("the write gate (S1) and the closed tables", () => {
    it("refuses krajozbior_app a direct write even with the switch on", async () => {
      const someone = await newAccount();

      for (const statement of [
        `insert into public.organizations (name, slug, kind) values ('x', 'x-gate', 'other')`,
        `insert into public.organization_members (organization_id, user_id)
           values (gen_random_uuid(), '${someone.id}')`,
        `insert into public.operations_audit (operation, operator_label, outcome, reason)
           values ('grant_curator', 'x', 'applied', 'x')`,
      ]) {
        await expect(
          inApp({ user: someone.id, gate: true }, (client) => client.query(statement)),
          statement,
        ).rejects.toMatchObject(denied);
      }
    });

    it("refuses the owner login too: the switch needs session_user krajozbior_app", async () => {
      const someone = await newAccount();
      const [{ id: organizationId }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ('Własna', $1, 'other') returning id`,
        [`wlasna-${randomUUID().slice(0, 6)}`],
      );

      for (const statement of [
        `insert into public.organizations (name, slug, kind) values ('x', 'x-owner', 'other')`,
        `insert into public.organization_members (organization_id, user_id)
           values ('${organizationId}', '${someone.id}')`,
        `insert into public.operations_audit (operation, operator_label, outcome, reason)
           values ('grant_curator', 'x', 'applied', 'x')`,
      ]) {
        await expect(
          withClient(db.urls.krajozbior_owner, async (client) => {
            await client.query("begin");
            await client.query(`select set_config('krajozbior.curator_panel_write', 'on', true)`);
            try {
              await client.query(statement);
            } finally {
              await client.query("rollback");
            }
          }),
          statement,
        ).rejects.toMatchObject(denied);
      }
    });

    it("lets the administrator read applications only through the function", async () => {
      expect(
        await inApp(
          { user: admin.id, token: adminToken },
          async (client) => (await client.query(`select * from public.curator_applications`)).rows,
        ),
      ).toEqual([]);
    });

    it("returns at most 200 rows from the list", async () => {
      const applicant = await newAccount();

      await admin$(
        `insert into public.curator_applications
           (applicant_user_id, organization_name, organization_kind, applicant_role, contact,
            status, decided_at, rejection_reason)
         select $1, 'Gmina ' || n, 'other', 'rola', 'kontakt', 'rejected', now(), 'powód'
           from generate_series(1, 205) as n`,
        [applicant.id],
      );

      const listed = await listCuratorApplications(sessionOf(admin, adminToken), "rejected", deps);

      expect(listed.status === "ok" && listed.value.length).toBe(200);
    });
  });

  describe("the applicant's use cases", () => {
    it("submits, shows the state, rejects a second pending one and withdraws", async () => {
      const applicant = await newAccount();

      expect(await getMyCuratorApplication(asUser(applicant), deps)).toEqual({
        status: "ok",
        value: { application: null, state: "none" },
      });
      expect(await submitCuratorApplication(asUser(applicant), form, deps)).toMatchObject({
        status: "ok",
      });
      expect(await submitCuratorApplication(asUser(applicant), form, deps)).toEqual({
        status: "conflict",
        code: "pending_exists",
      });

      const view = await getMyCuratorApplication(asUser(applicant), deps);
      const application =
        view.status === "ok" ? (view.value.application as MyCuratorApplication) : null;

      expect(view).toMatchObject({ status: "ok", value: { state: "pending" } });
      expect(application).toMatchObject({ organizationName: "Gmina Testowa", websiteUrl: null });
      expect(Object.keys(application ?? {})).not.toContain("applicantUserId");

      expect(await withdrawCuratorApplication(asUser(applicant), deps)).toEqual({
        status: "ok",
        value: null,
      });
      expect(await withdrawCuratorApplication(asUser(applicant), deps)).toEqual({
        status: "not_found",
      });
    });

    it("refuses the 21st application with too_many_applications", async () => {
      const applicant = await newAccount();

      await admin$(
        `insert into public.curator_applications
           (applicant_user_id, organization_name, organization_kind, applicant_role, contact,
            status, decided_at, rejection_reason)
         select $1, 'Gmina ' || n, 'other', 'rola', 'kontakt', 'rejected', now(), 'powód'
           from generate_series(1, 20) as n`,
        [applicant.id],
      );

      expect(await submitCuratorApplication(asUser(applicant), form, deps)).toEqual({
        status: "conflict",
        code: "too_many_applications",
      });
    });

    it("refuses to withdraw an approved application", async () => {
      const applicant = await newAccount();
      const id = await submit(applicant);

      await decideCuratorApplication(
        sessionOf(admin, adminToken),
        id,
        {
          decision: "approve",
          organizationName: "Do zachowania",
          organizationSlug: "do-zachowania",
        },
        deps,
      );

      expect(await withdrawCuratorApplication(asUser(applicant), deps)).toEqual({
        status: "conflict",
        code: "already_decided",
      });
    });
  });

  describe("migration", () => {
    it("reverts and applies again, keeping the existing tables and their audit entries", async () => {
      const owner = await MikroORM.init(createOrmConfig(db.urls.krajozbior_owner));
      const objects = () =>
        admin$<Record<string, unknown>>(
          `select to_regclass('public.curator_applications')::text as "table",
                  to_regprocedure('public.app_require_live_admin()')::text as helper,
                  (select count(*)::int from pg_policies
                    where policyname in ('organizations_panel_insert', 'organization_members_panel_insert',
                                         'organization_members_panel_delete', 'operations_audit_panel_insert')) as policies`,
        );

      try {
        expect(await objects()).toEqual([
          { table: "curator_applications", helper: "app_require_live_admin()", policies: 4 },
        ]);

        await owner.migrator.down({ to: "Migration20261122100000_place_photos_ops_version_check" });
        expect(await objects()).toEqual([{ table: null, helper: null, policies: 0 }]);

        await owner.migrator.up();
        expect(await objects()).toEqual([
          { table: "curator_applications", helper: "app_require_live_admin()", policies: 4 },
        ]);
      } finally {
        await owner.close(true);
      }
    });
  });
});
