import { MikroORM } from "@mikro-orm/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getReportQueue } from "@/features/reports/application/curator-reports";
import type { ReportsDeps } from "@/features/reports/application/report-types";
import { formatDisplayName } from "@/features/profile/domain/display-name";
import { REJECT_REASONS, REPORT_CATEGORIES } from "@/features/reports/domain/report";
import { handleDecision } from "@/features/reports/http/decision-http";
import { postgresReportsRepository } from "@/features/reports/infrastructure/postgres-reports-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// P4b, PR A: the table `place_reports` and the functions of the curator on the real database, as
// krajozbior_app on ONE pooled connection (a leaked context would show in the next test). Class
// CUR: the author reads their own reports, a curator only through the three functions, and a
// curator of another organization, an administrator without membership and a guest see nothing.
let db: ScratchDatabase;
let app: MikroORM;

const author = { ...newUser("rep-author"), role: "user" as const };
const explorerB = { ...newUser("rep-explorer-b"), role: "user" as const };
const firstNameOnly = { ...newUser("rep-first-name-only"), role: "user" as const };
const leaver = { ...newUser("rep-leaver"), role: "user" as const };
const joiner = { ...newUser("rep-joiner"), role: "user" as const };
const curA = { ...newUser("rep-cur-a"), role: "user" as const };
const curA2 = { ...newUser("rep-cur-a2"), role: "user" as const };
const curB = { ...newUser("rep-cur-b"), role: "user" as const };
const curS = { ...newUser("rep-cur-s"), role: "user" as const };
const curBig = { ...newUser("rep-cur-big"), role: "user" as const };
const admin = { ...newUser("rep-admin"), role: "admin" as const };

let orgA = "";
let orgB = "";
let orgS = "";
let orgBig = "";
let publishedCollection = "";
let places: string[] = [];
let draftPlace = "";
let placeS = "";
let placeBig = "";

const f = albumFixtures({ db: () => db, app: () => app });
const deps = (): ReportsDeps => ({
  limiter: { reserve: async () => ({ allowed: true }) },
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  repository: postgresReportsRepository,
});

const report = async (
  actor: { id: string },
  placeId: string,
  category = "closed",
  message = "Brama jest zamknięta",
) =>
  (
    await f.as(
      actor,
      `insert into public.place_reports (place_id, category, message) values (?, ?, ?) returning id`,
      [placeId, category, message],
    )
  )[0]!.id as string;

const decide = (
  actor: { id: string },
  id: string,
  action: string,
  version: number,
  reason: string | null = null,
  note: string | null = null,
) =>
  f.as(actor, `select public.app_decide_report(?::uuid, ?, ?, ?, ?::integer) as version`, [
    id,
    action,
    reason,
    note,
    version,
  ]);

const queue = (actor: { id: string }, organizationId: string, state = "open", limit = 200) =>
  f.as(actor, `select * from public.app_report_queue(?::uuid, ?, ?::integer)`, [
    organizationId,
    state,
    limit,
  ]);

const count = async (actor: { id: string }, organizationId: string) =>
  (await f.as(actor, `select public.app_report_counts(?::uuid) as n`, [organizationId]))[0]!.n;

const stored = async (id: string) =>
  (
    await f.admin$<{
      status: string;
      version: number;
      decided_by: string | null;
      decided_at: Date | null;
      reject_reason: string | null;
      organization_id: string;
      place_name_snapshot: string;
      author_id: string | null;
    }>(`select * from public.place_reports where id = $1`, [id])
  )[0]!;

const rejectedByPrivilege = /permission denied/;

describe("place_reports: access of the author and the curator (P4b)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_place_reports");
    await db.migrate();
    await f.insertUsers([
      author,
      explorerB,
      firstNameOnly,
      leaver,
      joiner,
      curA,
      curA2,
      curB,
      curS,
      curBig,
      admin,
    ]);
    orgA = await f.newOrganization("Gmina A", "gmina-a", [curA, curA2]);
    orgB = await f.newOrganization("Gmina B", "gmina-b", [curB]);
    orgS = await f.newOrganization("Gmina S", "gmina-s", [curS]);
    orgBig = await f.newOrganization("Gmina Duża", "gmina-duza", [curBig]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });

    const published = await f.publishedCollection(curA, orgA, 3);

    publishedCollection = published.collectionId;
    places = published.placeIds;
    draftPlace = (await f.draftCollection(curA, orgA, 1)).placeIds[0]!;
    await f.publishedCollection(curB, orgB, 1);
    placeS = (await f.publishedCollection(curS, orgS, 1)).placeIds[0]!;
    placeBig = (await f.publishedCollection(curBig, orgBig, 1)).placeIds[0]!;

    await f.as(
      author,
      `insert into public.profiles (first_name, family_initial) values ('Anna', 'K')`,
    );
    await f.as(
      firstNameOnly,
      `insert into public.profiles (first_name, family_initial) values ('Anna', null)`,
    );
  }, 90_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("has row security enabled and forced, and the application role cannot skip it", async () => {
    await withClient(db.adminUrl, async (client) => {
      expect(await findRowLevelSecurityGaps(client, ["public.place_reports"])).toEqual([]);
      expect(await findApplicationRoleGaps(client)).toEqual([]);
    });
  });

  it("gives exactly the privileges of the spec: a column select without decided_by, three insert columns, nothing else", async () => {
    const [row] = await f.admin$<Record<string, boolean>>(
      `select
         has_table_privilege('krajozbior_app', 'public.place_reports', 'select') as table_select,
         has_column_privilege('krajozbior_app', 'public.place_reports', 'decided_by', 'select') as decided_by_select,
         has_column_privilege('krajozbior_app', 'public.place_reports', 'author_id', 'select') as author_select,
         has_column_privilege('krajozbior_app', 'public.place_reports', 'message', 'select') as message_select,
         has_column_privilege('krajozbior_app', 'public.place_reports', 'place_id', 'insert') as place_insert,
         has_column_privilege('krajozbior_app', 'public.place_reports', 'category', 'insert') as category_insert,
         has_column_privilege('krajozbior_app', 'public.place_reports', 'message', 'insert') as message_insert,
         has_column_privilege('krajozbior_app', 'public.place_reports', 'author_id', 'insert') as author_insert,
         has_column_privilege('krajozbior_app', 'public.place_reports', 'organization_id', 'insert') as organization_insert,
         has_column_privilege('krajozbior_app', 'public.place_reports', 'status', 'insert') as status_insert,
         has_column_privilege('krajozbior_app', 'public.place_reports', 'status', 'update') as status_update,
         has_table_privilege('krajozbior_app', 'public.place_reports', 'update') as table_update,
         has_table_privilege('krajozbior_app', 'public.place_reports', 'delete') as table_delete,
         has_table_privilege('krajozbior_app', 'public.place_reports', 'truncate') as table_truncate,
         has_table_privilege('krajozbior_app', 'public.place_reports', 'references') as table_references,
         has_table_privilege('krajozbior_app', 'public.place_reports', 'trigger') as table_trigger`,
    );

    expect(row).toEqual({
      table_select: false,
      decided_by_select: false,
      author_select: true,
      message_select: true,
      place_insert: true,
      category_insert: true,
      message_insert: true,
      author_insert: false,
      organization_insert: false,
      status_insert: false,
      status_update: false,
      table_update: false,
      table_delete: false,
      table_truncate: false,
      table_references: false,
      table_trigger: false,
    });

    // krajozbior_auth and krajozbior_ops have no right to the table at all, not even a column.
    for (const role of ["krajozbior_auth", "krajozbior_ops"]) {
      const [none] = await f.admin$<{ any: boolean }>(
        `select has_any_column_privilege('${role}', 'public.place_reports',
                  'select, insert, update, references') or
                has_table_privilege('${role}', 'public.place_reports',
                  'select, insert, update, delete, truncate, references, trigger') as any`,
      );

      expect(none!.any, role).toBe(false);
    }
  });

  it("lets only krajozbior_app execute the three functions of the curator", async () => {
    const rows = await f.admin$<{
      name: string;
      app: boolean;
      auth: boolean;
      ops: boolean;
      public: number;
      definer: boolean;
      owner: string;
      config: string[];
    }>(
      `select p.proname as name,
              has_function_privilege('krajozbior_app', p.oid, 'execute') as app,
              has_function_privilege('krajozbior_auth', p.oid, 'execute') as auth,
              has_function_privilege('krajozbior_ops', p.oid, 'execute') as ops,
              (select count(*)::int from aclexplode(p.proacl) a where a.grantee = 0) as public,
              p.prosecdef as definer, pg_get_userbyid(p.proowner) as owner, p.proconfig as config
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('app_report_counts', 'app_report_queue', 'app_decide_report')
        order by 1`,
    );

    expect(rows.map(({ name }) => name)).toEqual([
      "app_decide_report",
      "app_report_counts",
      "app_report_queue",
    ]);
    for (const row of rows) {
      expect(row, row.name).toMatchObject({
        app: true,
        auth: false,
        ops: false,
        public: 0,
        definer: true,
        owner: "krajozbior_owner",
      });
      expect(row.config, row.name).toContain('search_path=""');
    }
  });

  it("keeps the lists of the migration equal to the lists of the domain", async () => {
    const checks = await f.admin$<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
        where c.conrelid = 'public.place_reports'::regclass and c.contype = 'c'`,
    );
    const quoted = (definition: string) =>
      [...definition.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]);
    const category = checks.find(({ def }) => def.includes("category"))!.def;
    const reason = checks.find(({ def }) => def.includes("reject_reason"))!.def;

    expect(quoted(category).sort()).toEqual([...REPORT_CATEGORIES].sort());
    expect(quoted(reason).sort()).toEqual([...REJECT_REASONS].sort());
  });

  it("shows nothing and refuses everything without a context", async () => {
    await report(author, places[0]!, "closed", "pierwsze zgłoszenie");

    expect(await f.asGuest(`select id from public.place_reports`)).toEqual([]);
    await expect(
      f.asGuest(`insert into public.place_reports (place_id, category) values (?, 'closed')`, [
        places[0],
      ]),
    ).rejects.toThrow(/read-only|row-level security/);
    await expect(
      f.asGuest(`select public.app_report_counts(?::uuid)`, [orgA]),
    ).rejects.toMatchObject({
      constraint: "forbidden",
    });
    await expect(queue({ id: "" }, orgA)).rejects.toThrow();
  });

  it("keeps a report from every other explorer, and refuses raw changes", async () => {
    const id = await report(author, places[1]!, "other", "opis problemu");

    expect(await f.as(explorerB, `select id from public.place_reports`)).toEqual([]);
    expect(
      await f.as(author, `select id from public.place_reports where id = ?`, [id]),
    ).toHaveLength(1);
    await expect(
      f.as(
        explorerB,
        `insert into public.place_reports (place_id, category, author_id) values (?, 'closed', ?)`,
        [places[1], author.id],
      ),
    ).rejects.toThrow(rejectedByPrivilege);
    // An INSERT as B that tries to name the author through the default does not work either:
    // the default is the actor, so the row is B's own.
    const own = await report(explorerB, places[1]!, "closed", "moje");

    expect((await stored(own)).author_id).toBe(explorerB.id);
    await expect(
      f.as(author, `update public.place_reports set message = 'x' where id = ?`, [id]),
    ).rejects.toThrow(rejectedByPrivilege);
    await expect(
      f.as(author, `delete from public.place_reports where id = ?`, [id]),
    ).rejects.toThrow(rejectedByPrivilege);
    await expect(
      f.as(author, `select decided_by from public.place_reports where id = ?`, [id]),
    ).rejects.toThrow(rejectedByPrivilege);
    await expect(f.as(author, `select * from public.place_reports`)).rejects.toThrow(
      rejectedByPrivilege,
    );
  });

  it("refuses a report about a draft, an unapproved organization, a member's own place and no place", async () => {
    // a place of a draft collection of an approved organization (known uuid)
    await expect(report(author, draftPlace)).rejects.toThrow(/row-level security/);
    // a member of the organization reports through the editor, not the queue
    await expect(report(curA, places[0]!)).rejects.toThrow(/row-level security/);
    await expect(report(curA2, places[0]!)).rejects.toThrow(/row-level security/);
    // an organization that is not approved
    await f.suspendOrganization(orgS);
    await expect(report(author, placeS)).rejects.toThrow(/row-level security/);
    await f.approveOrganization(orgS);
    expect(await report(author, placeS, "missing", "")).toMatch(/^[0-9a-f-]{36}$/);
    // no place at all
    await expect(
      f.as(author, `insert into public.place_reports (category, message) values ('closed', 'x')`),
    ).rejects.toThrow(/row-level security/);
    // the organization and the name come from the place; a client cannot name them
    await expect(
      f.as(
        author,
        `insert into public.place_reports (place_id, category, organization_id) values (?, 'closed', ?)`,
        [places[2], orgB],
      ),
    ).rejects.toThrow(rejectedByPrivilege);

    const id = await report(author, places[2]!, "missing", "");
    const row = await stored(id);

    expect(row).toMatchObject({
      organization_id: orgA,
      place_name_snapshot: "Miejsce",
      status: "open",
    });
  });

  it("refuses a report of a kind that needs words without words", async () => {
    await expect(report(author, places[2]!, "other", "   ")).rejects.toThrow(
      /place_reports_open_text_check/,
    );
    await expect(report(author, places[2]!, "wrong_info", "")).rejects.toThrow(
      /place_reports_open_text_check/,
    );
    await expect(report(author, places[2]!, "closed", "ukryte‮tekstu")).rejects.toThrow(
      /check constraint/,
    );
    await expect(report(author, places[2]!, "closed", "a".repeat(1001))).rejects.toThrow(
      /check constraint/,
    );
    await expect(report(author, places[2]!, "nope", "x")).rejects.toThrow(/check constraint/);
  });

  describe("the curator of another organization, an administrator and a guest", () => {
    let id = "";

    beforeAll(async () => {
      id = await report(explorerB, places[0]!, "closed", "tylko dla organizacji A");
    });

    it("see no report of organization A, in no function", async () => {
      for (const outsider of [curB, admin]) {
        expect(await queue(outsider, orgA), outsider.email).toEqual([]);
        expect(await queue(outsider, orgA, "decided"), outsider.email).toEqual([]);
        expect(await count(outsider, orgA), outsider.email).toBe(0);
        await expect(decide(outsider, id, "accept", 1), outsider.email).rejects.toMatchObject({
          constraint: "not_found",
        });
        expect((await stored(id)).status).toBe("open");
        // Row security alone, as the owner function would read it: no row without a membership.
        expect(
          await f.as(outsider, `select id from public.place_reports where id = ?`, [id]),
        ).toEqual([]);
      }
    });

    it("answer 404 on the route for the curator B and the administrator, 401 for a guest", async () => {
      const call = (actor: { id: string; role: "user" | "admin" } | null) =>
        handleDecision(
          new Request("http://localhost/api/curator/reports/x/decision", {
            method: "POST",
            headers: { "content-type": "application/json", host: "localhost" },
            body: JSON.stringify({ action: "accept", version: 1 }),
          }),
          id,
          { getActor: async () => actor, deps },
        );

      expect((await call(curB)).status).toBe(404);
      expect((await call(admin)).status).toBe(404);
      expect((await call(null)).status).toBe(401);
      expect((await stored(id)).status).toBe("open");
    });

    it("do not see the report in the use case either: a foreign organization is not_found, no membership is forbidden", async () => {
      expect(await getReportQueue(curB, orgA, "open", deps())).toEqual({ status: "not_found" });
      expect(await getReportQueue(admin, orgA, "open", deps())).toEqual({ status: "forbidden" });
    });
  });

  it("shows a curator the label of the author and no personal column", async () => {
    const named = await report(author, places[0]!, "wrong_location", "pinezka obok");
    const anonymous = await report(explorerB, places[1]!, "wrong_location", "bez imienia");
    const rows = await queue(curA, orgA);
    const byId = new Map(rows.map((row) => [row.id as string, row]));

    expect(byId.get(named)!.author_label).toBe("Anna K.");
    expect(byId.get(anonymous)!.author_label).toBe("Odkrywca");
    // the same rule as the application's: a name without the family initial is the bare name
    expect(byId.get(named)!.author_label).toBe(formatDisplayName("Anna", "K"));
    expect(byId.get(anonymous)!.author_label).toBe(formatDisplayName(null, null));

    const nameOnly = await report(firstNameOnly, places[2]!, "wrong_info", "tylko imię");
    const withNameOnly = (await queue(curA, orgA)).find((row) => row.id === nameOnly)!;

    expect(withNameOnly.author_label).toBe("Anna");
    expect(withNameOnly.author_label).toBe(formatDisplayName("Anna", null));
    expect(byId.get(named)).toMatchObject({
      author_gone: false,
      place_deleted: false,
      status: "open",
    });
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        "id",
        "category",
        "message",
        "status",
        "reject_reason",
        "decision_note",
        "created_at",
        "decided_at",
        "version",
        "place_id",
        "place_name",
        "place_deleted",
        "author_label",
        "author_gone",
      ].sort(),
    );
    // the oldest first
    const times = (
      await f.as(
        curA,
        `select extract(epoch from q.created_at)::float as t
           from public.app_report_queue(?::uuid, 'open', 200) q`,
        [orgA],
      )
    ).map((row) => row.t as number);

    // `rows` was read before the report with the first name only was filed
    expect(times).toHaveLength((await queue(curA, orgA)).length);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("decides, undoes and refuses what the rules refuse", async () => {
    const id = await report(author, places[2]!, "private_or_unsafe", "teren prywatny");

    await expect(decide(curA, id, "reject", 1)).rejects.toMatchObject({
      constraint: "invalid_argument",
    });
    await expect(decide(curA, id, "reject", 1, "nope")).rejects.toMatchObject({
      constraint: "invalid_argument",
    });
    await expect(decide(curA, id, "delete", 1)).rejects.toMatchObject({
      constraint: "invalid_argument",
    });
    await expect(decide(curA, id, "undo", 1)).rejects.toMatchObject({
      constraint: "invalid_state",
    });
    expect((await stored(id)).version).toBe(1);

    expect(
      (await decide(curA, id, "reject", 1, "not_accurate", "Sprawdziliśmy na miejscu."))[0],
    ).toEqual({
      version: 2,
    });

    const rejected = await stored(id);

    expect(rejected).toMatchObject({
      status: "rejected",
      reject_reason: "not_accurate",
      decided_by: curA.id,
      version: 2,
    });
    expect(rejected.decided_at).toBeInstanceOf(Date);

    // the author sees the decision, but never who took it
    const [seen] = await f.as(
      author,
      `select status, reject_reason, decision_note, decided_at from public.place_reports where id = ?`,
      [id],
    );

    expect(seen).toMatchObject({
      status: "rejected",
      reject_reason: "not_accurate",
      decision_note: "Sprawdziliśmy na miejscu.",
    });
    // a second curator with the old version
    await expect(decide(curA2, id, "accept", 1)).rejects.toMatchObject({
      constraint: "stale_version",
    });
    await expect(decide(curA2, id, "accept", 2)).rejects.toMatchObject({
      constraint: "invalid_state",
    });
    expect((await queue(curA, orgA, "decided")).find((row) => row.id === id)).toMatchObject({
      status: "rejected",
      reject_reason: "not_accurate",
      version: 2,
    });
    expect((await queue(curA, orgA)).find((row) => row.id === id)).toBeUndefined();

    expect((await decide(curA2, id, "undo", 2))[0]).toEqual({ version: 3 });
    expect(await stored(id)).toMatchObject({
      status: "open",
      reject_reason: null,
      decided_by: null,
      decided_at: null,
      version: 3,
    });
    expect((await decide(curA, id, "accept", 3, null, "  "))[0]).toEqual({ version: 4 });
    expect(await stored(id)).toMatchObject({ status: "accepted", reject_reason: null, version: 4 });
  });

  it("does not let an author who became a member decide their own report", async () => {
    const id = await report(joiner, places[0]!, "closed", "zgłoszenie przed członkostwem");

    await f.admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [orgA, joiner.id],
    );
    await expect(decide(joiner, id, "accept", 1)).rejects.toMatchObject({
      constraint: "own_report",
    });
    expect((await stored(id)).status).toBe("open");
    await f.admin$(
      `delete from public.organization_members where organization_id = $1 and user_id = $2`,
      [orgA, joiner.id],
    );
  });

  it("does not let a decision be undone after the author deleted the account, and the account can be deleted", async () => {
    const id = await report(leaver, places[1]!, "missing", "to już nie istnieje");

    await decide(curA, id, "reject", 1, "duplicate");
    // the account goes through krajozbior_auth, as in the application
    await withClient(db.urls.krajozbior_auth, (client) =>
      client.query(`delete from auth.users where id = $1`, [leaver.id]),
    );

    expect(await stored(id)).toMatchObject({ author_id: null, status: "rejected" });
    await expect(decide(curA, id, "undo", 2)).rejects.toMatchObject({ constraint: "author_gone" });

    const row = (await queue(curA, orgA, "decided")).find((item) => item.id === id);

    expect(row).toMatchObject({ author_label: "Konto usunięte", author_gone: true });
  });

  it("keeps the report when the curator who decided deletes the account (not the last member)", async () => {
    const extra = { ...newUser("rep-cur-extra"), role: "user" as const };

    await f.insertUsers([extra]);
    await f.admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [orgA, extra.id],
    );

    const id = await report(explorerB, places[2]!, "closed", "przed odejściem kuratora");

    await decide(extra, id, "accept", 1);
    expect((await stored(id)).decided_by).toBe(extra.id);
    await withClient(db.urls.krajozbior_auth, (client) =>
      client.query(`delete from auth.users where id = $1`, [extra.id]),
    );
    expect(await stored(id)).toMatchObject({ status: "accepted", decided_by: null });
  });

  it("lets only one of two curators decide the same report at the same moment", async () => {
    const id = await report(explorerB, places[0]!, "other", "dwóch kuratorów naraz");
    const open = async (actor: { id: string }) => {
      const client = new Client({ connectionString: db.urls.krajozbior_app });

      await client.connect();
      await client.query("begin");
      await client.query("select set_config('app.user_id', $1, true)", [actor.id]);

      return client;
    };
    const first = await open(curA);
    const second = await open(curA2);

    try {
      await first.query(`select public.app_decide_report($1::uuid, 'accept', null, null, 1)`, [id]);

      // the second waits for the lock of the first (FOR UPDATE) and then sees the new version
      const waiting = second
        .query(`select public.app_decide_report($1::uuid, 'accept', null, null, 1)`, [id])
        .then(
          () => "decided",
          (error: { constraint?: string }) => error.constraint,
        );

      await new Promise((resolve) => setTimeout(resolve, 300));
      await first.query("commit");

      expect(await waiting).toBe("stale_version");
    } finally {
      await second.query("rollback").catch(() => undefined);
      await first.end();
      await second.end();
    }

    expect((await stored(id)).version).toBe(2);
  });

  it("is hard against bad arguments, a huge limit and a missing membership of an active organization", async () => {
    await expect(queue(curA, orgA, "xyz", 10)).rejects.toMatchObject({
      constraint: "invalid_argument",
    });
    await expect(
      f.as(curA, `select * from public.app_report_queue(?::uuid, null, 10)`, [orgA]),
    ).rejects.toMatchObject({
      constraint: "invalid_argument",
    });
    // a null limit is the maximum, a limit of one is one
    expect(
      (await f.as(curA, `select * from public.app_report_queue(?::uuid, 'open', 1)`, [orgA]))
        .length,
    ).toBeLessThanOrEqual(1);
    expect(
      await f.as(curA, `select * from public.app_report_queue(null::uuid, 'open', 1)`),
    ).toEqual([]);
  });

  it("counts the same open reports as the list shows, and shows 200 of 201 (W4c)", async () => {
    // 201 open reports without an author (as the superuser; the trigger fills the rest)
    await f.admin$(
      `insert into public.place_reports (place_id, category, message, author_id)
       select $1, 'other', 'zgłoszenie ' || g, null from generate_series(1, 201) g`,
      [placeBig],
    );

    expect(await count(curBig, orgBig)).toBe(201);
    expect((await queue(curBig, orgBig, "open", 100000)).length).toBe(200);
    expect((await queue(curBig, orgBig, "decided", 100000)).length).toBe(0);

    const outcome = await getReportQueue(curBig, orgBig, "open", deps());

    expect(outcome).toMatchObject({ status: "ok", value: { openTotal: 201 } });
    expect(outcome.status === "ok" && outcome.value.items.length).toBe(200);

    // N <= 200: the counter and the list agree on the organization A
    expect(await count(curA, orgA)).toBe((await queue(curA, orgA, "open", 200)).length);
  });

  it("shows decided reports newest first, at most 50", async () => {
    await f.admin$(
      `insert into public.place_reports (place_id, category, message, author_id)
       select $1, 'other', 'rozpatrzone ' || g, null from generate_series(1, 60) g`,
      [placeBig],
    );
    await f.admin$(
      `update public.place_reports set status = 'accepted', decided_at = now() - (random() * interval '1 day')
        where organization_id = $1 and message like 'rozpatrzone %'`,
      [orgBig],
    );

    const rows = await queue(curBig, orgBig, "decided", 100000);
    const times = (
      await f.as(
        curBig,
        `select extract(epoch from q.decided_at)::float as t
           from public.app_report_queue(?::uuid, 'decided', 100000) q`,
        [orgBig],
      )
    ).map((row) => row.t as number);

    expect(rows).toHaveLength(50);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("gives a member of a suspended organization nothing", async () => {
    const id = await report(author, placeS, "closed", "organizacja jeszcze działa");

    expect(await count(curS, orgS)).toBeGreaterThan(0);
    await f.suspendOrganization(orgS);
    try {
      expect(await count(curS, orgS)).toBe(0);
      expect(await queue(curS, orgS)).toEqual([]);
      await expect(decide(curS, id, "accept", 1)).rejects.toMatchObject({
        constraint: "not_found",
      });
    } finally {
      await f.approveOrganization(orgS);
    }
    expect((await stored(id)).status).toBe("open");
  });

  it("finds the editor of a place also in a collection taken back to a draft, and says so for a removed place (M4)", async () => {
    const own = await report(explorerB, places[2]!, "closed", "przed cofnięciem kolekcji");
    const other = await f.publishedCollection(curA, orgA, 1);
    const otherPlace = other.placeIds[0]!;
    const removed = await report(author, otherPlace, "missing", "");

    await f.setStatus(curA, publishedCollection, "draft");
    await f.setStatus(curA, other.collectionId, "draft");

    // the name comes from the snapshot, the link from the panel's own policies
    const view = async () => {
      const outcome = await getReportQueue(curA, orgA, "open", deps());

      return outcome.status === "ok" ? outcome.value.items : [];
    };
    const draftRow = (await view()).find((item) => item.id === own)!;

    expect(draftRow).toMatchObject({ placeName: "Miejsce", placeDeleted: false });
    expect(draftRow.editCollectionId).toBe(publishedCollection);

    // the place is removed: the report stays with the name it had
    await f.admin$(`delete from public.collection_places where place_id = $1`, [otherPlace]);
    await f.admin$(`delete from public.places where id = $1`, [otherPlace]);

    const goneRow = (await view()).find((item) => item.id === removed)!;

    expect(goneRow).toMatchObject({
      placeId: null,
      placeName: "Miejsce",
      placeDeleted: true,
      editCollectionId: null,
    });
    expect(await stored(removed)).toMatchObject({ place_name_snapshot: "Miejsce" });
    await f.setStatus(curA, publishedCollection, "published");
  });

  it("lets a curator remove a place that has reports, open and decided", async () => {
    const holder = await f.draftCollection(curA, orgA, 1);
    const placeId = holder.placeIds[0]!;

    // a published collection makes the place reportable
    await f.setStatus(curA, holder.collectionId, "published");

    const open = await report(author, placeId, "closed", "otwarte");
    const decided = await report(author, placeId, "missing", "");

    await decide(curA, decided, "accept", 1);
    await f.as(curA, `delete from public.collection_places where place_id = ?`, [placeId]);
    await f.as(curA, `delete from public.places where id = ?`, [placeId]);

    expect(await stored(open)).toMatchObject({ place_name_snapshot: "Miejsce", status: "open" });
    expect(
      (
        await f.admin$<{ place_id: string | null }>(
          `select place_id from public.place_reports where id = $1`,
          [decided],
        )
      )[0]!.place_id,
    ).toBeNull();
  });

  it("limits the functions that the owner runs which read reports or profiles to the expected list (M5)", async () => {
    const rows = await f.admin$<{ name: string }>(
      `select p.proname as name
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.prosecdef
          and pg_get_userbyid(p.proowner) = 'krajozbior_owner'
          and p.prosrc ~* '(^|[^a-z_])(place_reports|profiles)([^a-z_]|$)'
        order by 1`,
    );

    // Adding a function of the owner that reads these tables is a security decision: change this
    // list on purpose, and name the reason in docs/data-isolation.md.
    expect(rows.map(({ name }) => name)).toEqual([
      "app_decide_report",
      "app_report_counts",
      "app_report_queue",
    ]);

    // Only the author-label policy of profiles was added for the owner by this change
    const policies = await f.admin$<{ tablename: string; policyname: string; cmd: string }>(
      `select tablename, policyname, cmd from pg_policies
        where schemaname = 'public' and 'krajozbior_owner' = any (roles)
          and tablename in ('place_reports', 'profiles')
        order by 1, 2`,
    );

    expect(policies).toEqual([
      { tablename: "place_reports", policyname: "place_reports_owner_select", cmd: "SELECT" },
      { tablename: "place_reports", policyname: "place_reports_owner_update", cmd: "UPDATE" },
      { tablename: "profiles", policyname: "profiles_owner_report_author_select", cmd: "SELECT" },
    ]);
  });

  it("does not leak the context between transactions on the same connection", async () => {
    expect((await f.as(author, `select id from public.place_reports`)).length).toBeGreaterThan(0);
    expect(await f.asGuest(`select id from public.place_reports`)).toEqual([]);
    expect(
      await f.as(explorerB, `select id from public.place_reports where author_id = ?`, [author.id]),
    ).toEqual([]);
  });
});
