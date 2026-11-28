import { MikroORM } from "@mikro-orm/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listMyReports, submitPlaceReport } from "@/features/reports/application/explorer-reports";
import type { ReportsDeps } from "@/features/reports/application/report-types";
import {
  DAILY_REPORT_LIMIT,
  OPEN_REPORTS_PER_AUTHOR_LIMIT,
  OPEN_REPORTS_PER_PLACE_LIMIT,
} from "@/features/reports/domain/limits";
import { handleSubmitReport } from "@/features/reports/http/submit-http";
import { postgresReportsRepository } from "@/features/reports/infrastructure/postgres-reports-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// P4b, PR B: sending a report of a problem with a place, on the real database as krajozbior_app on
// ONE pooled connection. The limits (10 a day, 50 open per author, 20 open per place), the
// duplicate, the undo of a decision that would make a duplicate, the deletion of the account of
// the author and the switch of the route. The access of the curator (PR A) is in
// place-reports-access.test.ts.
let db: ScratchDatabase;
let app: MikroORM;

const user = (name: string) => ({ ...newUser(name), role: "user" as const });
const curA = user("lim-cur-a");
const curB = user("lim-cur-b");
const explorer = user("lim-explorer");
const admin = { ...newUser("lim-admin"), role: "admin" as const };

let orgA = "";
let orgB = "";
let places: string[] = [];
let draftPlace = "";
let crowdedPlace = "";
let placeB = "";

const f = albumFixtures({ db: () => db, app: () => app });
const deps = (): ReportsDeps => ({
  limiter: { reserve: async () => ({ allowed: true }) },
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  repository: postgresReportsRepository,
});

const report = async (actor: { id: string }, placeId: string, category = "closed", message = "") =>
  (
    await f.as(
      actor,
      `insert into public.place_reports (place_id, category, message) values (?, ?, ?) returning id`,
      [placeId, category, message],
    )
  )[0]!.id as string;

const stored = async (id: string) =>
  (
    await f.admin$<{
      status: string;
      version: number;
      author_id: string | null;
      message: string;
    }>(`select status, version, author_id, message from public.place_reports where id = $1`, [id])
  )[0];

const decide = (actor: { id: string }, id: string, action: string, version: number) =>
  f.as(actor, `select public.app_decide_report(?::uuid, ?, ?, null, ?::integer) as version`, [
    id,
    action,
    action === "reject" ? "duplicate" : null,
    version,
  ]);

// Fresh explorers: every test that fills a limit uses its own, so the tests do not meet.
async function newExplorer(name: string) {
  const created = user(name);

  await f.insertUsers([created]);

  return created;
}

describe("place_reports: limits, duplicates and the deletion of the author's account (P4b, PR B)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_place_reports_limits");
    await db.migrate();
    await f.insertUsers([curA, curB, explorer, admin]);
    orgA = await f.newOrganization("Gmina A", "gmina-a", [curA]);
    orgB = await f.newOrganization("Gmina B", "gmina-b", [curB]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });

    places = (await f.publishedCollection(curA, orgA, 13)).placeIds;
    draftPlace = (await f.draftCollection(curA, orgA, 1)).placeIds[0]!;
    crowdedPlace = (await f.publishedCollection(curA, orgA, 1)).placeIds[0]!;
    placeB = (await f.publishedCollection(curB, orgB, 1)).placeIds[0]!;
  }, 90_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("keeps the constants of the domain equal to the numbers in the functions of the database", async () => {
    const source = async (name: string) =>
      (
        await f.admin$<{ src: string }>(
          `select prosrc as src from pg_proc where pronamespace = 'public'::regnamespace and proname = $1`,
          [name],
        )
      )[0]!.src;

    expect(await source("place_reports_limits")).toContain(`v_recent >= ${DAILY_REPORT_LIMIT}`);
    expect(await source("place_reports_limits")).toContain(
      `v_open >= ${OPEN_REPORTS_PER_AUTHOR_LIMIT}`,
    );
    expect(await source("place_reports_place_limit")).toContain(
      `v_open >= ${OPEN_REPORTS_PER_PLACE_LIMIT}`,
    );
  });

  it("runs the three BEFORE triggers in the order fill, limits, place_limit, and the two cleaners on the author", async () => {
    const triggers = await f.admin$<{ name: string; timing: string; definer: boolean }>(
      `select t.tgname as name,
              case when (t.tgtype & 2) <> 0 then 'before' else 'after' end as timing,
              p.prosecdef as definer
         from pg_trigger t join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid = 'public.place_reports'::regclass and not t.tgisinternal
        order by t.tgname`,
    );

    expect(triggers).toEqual([
      { name: "place_reports_clear_on_author_delete", timing: "before", definer: false },
      { name: "place_reports_fill", timing: "before", definer: false },
      { name: "place_reports_limits", timing: "before", definer: false },
      { name: "place_reports_place_limit", timing: "before", definer: true },
      { name: "place_reports_purge_orphaned", timing: "after", definer: true },
    ]);
  });

  it("refuses the 11th report within 24 hours, decided ones counting, and takes one again when the day passes", async () => {
    const author = await newExplorer("lim-daily");
    const ids: string[] = [];

    for (let i = 0; i < DAILY_REPORT_LIMIT; i += 1) {
      ids.push(await report(author, places[i]!));
    }

    await expect(report(author, places[10]!)).rejects.toMatchObject({
      constraint: "report_daily_limit",
    });

    // a decided report still counts as sent today
    await decide(curA, ids[0]!, "accept", 1);
    await decide(curA, ids[1]!, "reject", 1);
    await expect(report(author, places[10]!)).rejects.toMatchObject({
      constraint: "report_daily_limit",
    });

    // another explorer is not touched
    expect(await report(explorer, places[10]!)).toMatch(/^[0-9a-f-]{36}$/);

    // the oldest report leaves the window of 24 hours
    await f.admin$(
      `update public.place_reports set created_at = now() - interval '25 hours' where id = $1`,
      [ids[2]],
    );
    expect(await report(author, places[10]!)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses the 51st open report of one person and keeps the rest of the explorers free", async () => {
    const author = await newExplorer("lim-open");

    // 50 open reports of earlier days (ten places x five kinds), written as the superuser: the
    // daily limit does not count them, the open limit does
    await f.admin$(
      `insert into public.place_reports (place_id, category, message, author_id, created_at)
       select p.id, c.category, 'opis zgłoszenia', $1, now() - interval '3 days'
         from unnest($2::uuid[]) as p(id)
         cross join (values ('missing'), ('closed'), ('private_or_unsafe'), ('wrong_location'), ('other')) as c(category)`,
      [author.id, places.slice(0, 10)],
    );

    await expect(
      f.admin$(`select count(*)::int as n from public.place_reports where author_id = $1`, [
        author.id,
      ]),
    ).resolves.toEqual([{ n: OPEN_REPORTS_PER_AUTHOR_LIMIT }]);
    await expect(report(author, places[12]!)).rejects.toMatchObject({
      constraint: "report_open_limit",
    });

    // a decided report frees one place of the limit
    const [first] = await f.admin$<{ id: string }>(
      `select id from public.place_reports where author_id = $1 order by id limit 1`,
      [author.id],
    );

    await f.admin$(
      `update public.place_reports set status = 'accepted', decided_at = now() where id = $1`,
      [first!.id],
    );
    expect(await report(author, places[12]!, "closed", "po rozpatrzeniu jednego")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("refuses the 21st open report for one place from different authors, and says nothing about the others", async () => {
    const authors = [] as { id: string }[];

    for (let i = 0; i < OPEN_REPORTS_PER_PLACE_LIMIT; i += 1) {
      authors.push(await newExplorer(`lim-crowd-${i}`));
    }

    for (const author of authors) {
      await report(author, crowdedPlace, "closed", "");
    }

    const latecomer = await newExplorer("lim-crowd-late");

    await expect(report(latecomer, crowdedPlace, "missing", "")).rejects.toMatchObject({
      constraint: "report_place_limit",
    });
    // the function counts as the owner but the author reads only their own rows
    expect(await f.as(latecomer, `select id from public.place_reports`)).toEqual([]);

    // another place is not full; a decided report frees a place of the queue
    expect(await report(latecomer, places[0]!, "missing", "")).toMatch(/^[0-9a-f-]{36}$/);

    const [oldest] = await f.admin$<{ id: string }>(
      `select id from public.place_reports where place_id = $1 order by created_at, id limit 1`,
      [crowdedPlace],
    );

    await decide(curA, oldest!.id, "accept", 1);
    expect(await report(latecomer, crowdedPlace, "missing", "")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("lets only one of two parallel sends pass at nine reports of the day", async () => {
    const author = await newExplorer("lim-parallel");

    await f.admin$(
      `insert into public.place_reports (place_id, category, message, author_id)
       select p.id, 'closed', '', $1 from unnest($2::uuid[]) as p(id)`,
      [author.id, places.slice(0, 9)],
    );

    const open = async () => {
      const client = new Client({ connectionString: db.urls.krajozbior_app });

      await client.connect();
      await client.query("begin");
      await client.query("select set_config('app.user_id', $1, true)", [author.id]);

      return client;
    };
    const send = (client: Client, placeId: string) =>
      client.query(`insert into public.place_reports (place_id, category) values ($1, 'missing')`, [
        placeId,
      ]);
    const first = await open();
    const second = await open();

    try {
      await send(first, places[9]!);

      // the second waits for the advisory lock of the author and then counts ten
      const waiting = send(second, places[10]!).then(
        () => "sent",
        (error: { constraint?: string }) => error.constraint,
      );

      await new Promise((resolve) => setTimeout(resolve, 300));
      await first.query("commit");

      expect(await waiting).toBe("report_daily_limit");
    } finally {
      await second.query("rollback").catch(() => undefined);
      await first.end();
      await second.end();
    }

    expect(
      (
        await f.admin$<{ n: number }>(
          `select count(*)::int as n from public.place_reports where author_id = $1`,
          [author.id],
        )
      )[0]!.n,
    ).toBe(DAILY_REPORT_LIMIT);
  });

  it("answers a second open report of the same kind for the same place as duplicate_open, not as a failure", async () => {
    const author = await newExplorer("lim-duplicate");

    await report(author, places[0]!, "closed", "pierwsze");
    await expect(report(author, places[0]!, "closed", "drugie")).rejects.toMatchObject({
      code: "23505",
      constraint: "place_reports_one_open_idx",
    });

    const outcome = await submitPlaceReport(
      author,
      places[0]!,
      { category: "closed", message: "znowu" },
      deps(),
    );

    expect(outcome).toEqual({ status: "duplicate_open" });
    // another kind or another place is a new report
    expect(
      (await submitPlaceReport(author, places[0]!, { category: "missing" }, deps())).status,
    ).toBe("ok");
    expect(
      (await submitPlaceReport(author, places[1]!, { category: "closed" }, deps())).status,
    ).toBe("ok");
  });

  it("refuses the undo of a decision when the author has sent the same report again (before the update)", async () => {
    const author = await newExplorer("lim-undo");
    const first = await report(author, places[3]!, "closed", "stare");

    await decide(curA, first, "reject", 1);

    const again = await report(author, places[3]!, "closed", "nowe po odrzuceniu");

    await expect(decide(curA, first, "undo", 2)).rejects.toMatchObject({
      constraint: "duplicate_open",
    });
    expect(await stored(first)).toMatchObject({ status: "rejected", version: 2 });
    expect(await stored(again)).toMatchObject({ status: "open" });

    // the repository answers with a conflict (the route says 409), not with an exception
    const result = await deps().withUserContext(curA, (tx) =>
      postgresReportsRepository.decide(tx, {
        reportId: first,
        action: "undo",
        reason: null,
        note: null,
        version: 2,
      }),
    );

    expect(result).toEqual({ status: "conflict", reason: "duplicate_open" });

    // once the new report is decided, the old one can be brought back
    await decide(curA, again, "accept", 1);
    expect((await decide(curA, first, "undo", 2))[0]).toEqual({ version: 3 });
  });

  it("deletes the open reports of an author and empties the text of the decided ones with the account", async () => {
    const author = await newExplorer("lim-leaver");
    const openOther = await report(author, places[4]!, "other", "otwarte, inne");
    const openInfo = await report(author, places[5]!, "wrong_info", "otwarte, błąd w opisie");
    const openPlain = await report(author, places[6]!, "closed", "otwarte, zamknięte");
    const rejected = await report(author, places[7]!, "other", "odrzucone, dane osobowe");
    const accepted = await report(author, places[8]!, "wrong_info", "przyjęte, adres: ul. X 1");

    await decide(curA, rejected, "reject", 1);
    await decide(curA, accepted, "accept", 1);

    // the account goes through krajozbior_auth as in the application; the CHECK of the text must
    // not block the cascade for a report of the kind that needs words
    await withClient(db.urls.krajozbior_auth, (client) =>
      client.query(`delete from auth.users where id = $1`, [author.id]),
    );

    for (const id of [openOther, openInfo, openPlain]) {
      expect(await stored(id), id).toBeUndefined();
    }

    expect(await stored(rejected)).toMatchObject({
      status: "rejected",
      author_id: null,
      message: "",
    });
    expect(await stored(accepted)).toMatchObject({
      status: "accepted",
      author_id: null,
      message: "",
    });
  });

  it("gives an author only their own reports in the list, with no column of the deciding curator", async () => {
    const author = await newExplorer("lim-list");
    const other = await newExplorer("lim-list-other");
    const mine = await report(author, places[9]!, "closed", "moje");

    await report(other, places[9]!, "missing", "cudze");
    await decide(curA, mine, "reject", 1);

    const outcome = await listMyReports(author, deps());

    expect(outcome.status).toBe("ok");
    expect(outcome.status === "ok" && outcome.items.map((item) => item.id)).toEqual([mine]);
    expect(outcome.status === "ok" && Object.keys(outcome.items[0]!).sort()).toEqual(
      [
        "id",
        "category",
        "status",
        "rejectReason",
        "decisionNote",
        "createdAt",
        "decidedAt",
        "placeId",
        "placeName",
        "placeDeleted",
        "organizationName",
      ].sort(),
    );
    expect(outcome.status === "ok" && outcome.items[0]).toMatchObject({
      status: "rejected",
      rejectReason: "duplicate",
      organizationName: "Gmina A",
    });

    // an administrator and a curator see only what they sent themselves; a guest nothing
    const adminList = await listMyReports(admin, deps());

    expect(adminList).toEqual({ status: "ok", items: [] });
    expect(await listMyReports(curA, deps())).toEqual({ status: "ok", items: [] });
    expect(await listMyReports(null, deps())).toEqual({ status: "unauthenticated" });
  });

  describe("the route", () => {
    const post = (placeId: string, body: unknown) =>
      new Request(`http://localhost/api/places/${placeId}/reports`, {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost" },
        body: JSON.stringify(body),
      });
    const call = (
      placeId: string,
      body: unknown,
      actor: { id: string; role: "user" | "admin" } | null,
      enabled = true,
    ) =>
      handleSubmitReport(post(placeId, body), placeId, {
        enabled: () => enabled,
        getActor: async () => actor,
        deps,
      });
    const rowsOf = async (placeId: string) =>
      (
        await f.admin$<{ n: number }>(
          `select count(*)::int as n from public.place_reports where place_id = $1`,
          [placeId],
        )
      )[0]!.n;

    it("answers 404 and writes nothing while the switch is off, even for a valid session and body", async () => {
      const author = await newExplorer("lim-switch");
      const before = await rowsOf(places[11]!);
      const response = await call(places[11]!, { category: "closed", message: "x" }, author, false);

      expect(response.status).toBe(404);
      expect(await rowsOf(places[11]!)).toBe(before);
    });

    it("sends a report with the switch on and says which organization will look at it", async () => {
      const author = await newExplorer("lim-route");
      const response = await call(places[11]!, { category: "closed", message: "brama" }, author);

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ organizationName: "Gmina A" });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await rowsOf(places[11]!)).toBe(1);
    });

    it("answers 401 to a guest, 403 to a member of the organization, 404 to a draft and an unknown place", async () => {
      const author = await newExplorer("lim-route-refused");
      const body = { category: "closed", message: "x" };

      expect((await call(places[11]!, body, null)).status).toBe(401);
      expect((await call(places[11]!, body, curA)).status).toBe(403);
      expect((await call(draftPlace, body, author)).status).toBe(404);
      expect((await call("00000000-0000-4000-8000-000000000000", body, author)).status).toBe(404);
      expect((await call("not-a-uuid", body, author)).status).toBe(404);
      // a curator of another organization may report a place of this one
      expect((await call(placeB, body, curA)).status).toBe(201);
      expect(await rowsOf(draftPlace)).toBe(0);
    });

    it("answers 422 to a bad body, 409 to a duplicate and 429 to the limit, writing nothing extra", async () => {
      const author = await newExplorer("lim-route-codes");

      expect((await call(places[12]!, { category: "nope" }, author)).status).toBe(422);
      expect((await call(places[12]!, { category: "other", message: "  " }, author)).status).toBe(
        422,
      );
      expect((await call(places[12]!, { category: "closed" }, author)).status).toBe(201);

      const duplicate = await call(places[12]!, { category: "closed" }, author);

      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toMatchObject({ error: "duplicate_open" });

      // fill the day, then the 11th is a 429 with the message of the day
      for (let i = 0; i < DAILY_REPORT_LIMIT - 1; i += 1) {
        expect((await call(places[i]!, { category: "private_or_unsafe" }, author)).status).toBe(
          201,
        );
      }

      const limited = await call(places[10]!, { category: "private_or_unsafe" }, author);

      expect(limited.status).toBe(429);
      expect(await limited.json()).toMatchObject({
        error: "rate_limited",
        message: "Z Twojego konta wysłano w ciągu doby 10 zgłoszeń. Kolejne wyślesz jutro.",
      });
    });
  });
});
