import { randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { postgresAlbumRepository } from "@/features/album/infrastructure/postgres-album-repository";
import { getMyVisitOfPlace } from "@/features/visits/application/mark-past-visits";
import type { VisitDeps } from "@/features/visits/application/visit-types";
import { postgresVisitRepository } from "@/features/visits/infrastructure/postgres-visit-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// PR9: POST /api/me/visits/past and DELETE /api/me/visits/past/[placeId]
// through the real routes, the real use cases and the real database
// (docs/data-isolation.md, class PRIV). Only the session and the limiter come
// from the test. Who may call the routes, what they answer and what stays in
// the database.
const state = vi.hoisted(() => ({
  session: null as { id: string; role: "user" | "admin" } | null,
  allow: true,
  app: null as unknown as import("@mikro-orm/postgresql").MikroORM,
}));

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: async () => state.session }),
  getActionRateLimiter: () => ({
    reserve: async () =>
      state.allow ? { allowed: true } : { allowed: false, retryAfterSeconds: 7 },
  }),
}));
vi.mock("@/features/visits/infrastructure/visit-deps", () => ({
  getVisitDeps: () => deps(),
}));

let db: ScratchDatabase;
let app: MikroORM; // one connection: a context that leaks would be seen at once
let wide: MikroORM; // several connections: needed for truly parallel batches

const explorerA = newUser("pv-explorer-a");
const explorerB = newUser("pv-explorer-b");
const cur = newUser("pv-cur");
const a = { ...explorerA, role: "user" as const };
const b = { ...explorerB, role: "user" as const };
const curActor = { ...cur, role: "user" as const };

const f = albumFixtures({ db: () => db, app: () => app });
const deps = (): VisitDeps => ({
  withUserContext: (actor, work) => runInUserContext(state.app.em, actor, work),
  limiter: {
    reserve: async () =>
      state.allow ? { allowed: true } : { allowed: false, retryAfterSeconds: 7 },
  },
  repository: postgresVisitRepository,
  album: postgresAlbumRepository,
});

let postRoute: typeof import("@/app/api/me/visits/past/route");
let deleteRoute: typeof import("@/app/api/me/visits/past/[placeId]/route");
let organizationId = "";
let draftPlace = "";

const rowsOf = async (userId: string, placeId: string, kind?: string) =>
  Number(
    (
      await f.admin$<{ n: string }>(
        `select count(*) as n from public.visits
          where user_id = $1 and place_id = $2 and ($3::text is null or kind = $3)`,
        [userId, placeId, kind ?? null],
      )
    )[0]!.n,
  );

const allRowsOf = async (userId: string) =>
  Number(
    (
      await f.admin$<{ n: string }>(`select count(*) as n from public.visits where user_id = $1`, [
        userId,
      ])
    )[0]!.n,
  );

const month = { precision: "month", value: "2019-03" };
const batch = (placeIds: string[], date: unknown = month) => ({ placeIds, date });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  postRoute.POST(
    new Request("http://localhost/api/me/visits/past", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const del = (placeId: string, headers: Record<string, string> = {}) =>
  deleteRoute.DELETE(
    new Request(`http://localhost/api/me/visits/past/${placeId}`, {
      method: "DELETE",
      headers: { host: "localhost", ...headers },
    }),
    { params: Promise.resolve({ placeId }) },
  );

// A fresh published collection, so that tests do not share places.
const places = async (count: number) =>
  (await f.publishedCollection(curActor, organizationId, count)).placeIds;

describe("/api/me/visits/past", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_past_visit_route");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, cur]);
    organizationId = await f.newOrganization("Gmina Dawnych Wizyt", "gmina-dawnych-wizyt", [cur]);

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
    wide = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 4, max: 4 },
    });
    state.app = app;
    postRoute = await import("@/app/api/me/visits/past/route");
    deleteRoute = await import("@/app/api/me/visits/past/[placeId]/route");
    draftPlace = (await f.draftCollection(curActor, organizationId)).placeIds[0]!;
  }, 60_000);

  beforeEach(() => {
    state.session = null;
    state.allow = true;
    state.app = app;
  });

  afterAll(async () => {
    await wide?.close(true);
    await app?.close(true);
    await db?.drop();
  });

  it("denies a guest with 401 and records nothing, also for a broken body", async () => {
    const [place] = await places(1);

    for (const body of [batch([place!]), "not json"]) {
      const response = await post(body);

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(await rowsOf(explorerA.id, place!)).toBe(0);
    expect((await del(place!)).status).toBe(401);
  });

  it("denies a foreign origin with 403 before anything else", async () => {
    state.session = a;

    const [place] = await places(1);

    expect((await post(batch([place!]), { origin: "http://evil.example" })).status).toBe(403);
    expect((await del(place!, { origin: "http://evil.example" })).status).toBe(403);
    expect(await rowsOf(explorerA.id, place!)).toBe(0);
  });

  it("records the batch with the normalised date, answers with the counts and keeps it private", async () => {
    state.session = a;

    const [p1, p2] = await places(2);
    const response = await post(batch([p1!, p2!]));
    const text = await response.text();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.parse(text)).toEqual({ recorded: 2, alreadyVisited: 0 });
    expect(text).not.toContain(explorerA.id);

    const [row] = await f.admin$<{ kind: string; visited_on: string; date_precision: string }>(
      `select kind, visited_on::text, date_precision from public.visits
        where user_id = $1 and place_id = $2`,
      [explorerA.id, p1],
    );

    expect(row).toEqual({ kind: "past", visited_on: "2019-03-01", date_precision: "month" });

    // The kind and the date come back for A only.
    expect(await getMyVisitOfPlace(a, p1!, deps())).toEqual({
      status: "ok",
      value: { onSite: false, past: { precision: "month", visitedOn: "2019-03-01" } },
    });
    expect(await getMyVisitOfPlace(b, p1!, deps())).toEqual({
      status: "ok",
      value: { onSite: false, past: null },
    });
  });

  it("stores no date for 'I do not remember'", async () => {
    state.session = a;

    const [place] = await places(1);

    expect((await post(batch([place!], { precision: "unknown" }))).status).toBe(201);

    const [row] = await f.admin$<{ visited_on: string | null; date_precision: string }>(
      `select visited_on::text, date_precision from public.visits where place_id = $1`,
      [place],
    );

    expect(row).toEqual({ visited_on: null, date_precision: "unknown" });
  });

  it("answers 404 and writes NOTHING when a place is only in a draft, for an explorer and for the curator of the organization", async () => {
    const [published] = await places(1);

    for (const session of [a, curActor]) {
      state.session = session;

      expect((await post(batch([draftPlace]))).status).toBe(404);
      // A visible place in the same batch gets no row either.
      expect((await post(batch([published!, draftPlace]))).status).toBe(404);
      expect(await rowsOf(session.id, draftPlace)).toBe(0);
      expect(await rowsOf(session.id, published!)).toBe(0);
    }
  });

  it("answers 404 for an unknown place without a row", async () => {
    state.session = a;

    const [place] = await places(1);

    const before = await allRowsOf(explorerA.id);

    expect((await post(batch([place!, randomUUID()]))).status).toBe(404);
    expect(await rowsOf(explorerA.id, place!)).toBe(0);
    expect(await allRowsOf(explorerA.id)).toBe(before);
  });

  it("answers 404, not 500, and writes nothing for a place withdrawn meanwhile", async () => {
    state.session = a;

    const made = await f.publishedCollection(curActor, organizationId, 1);

    await f.setStatus(curActor, made.collectionId, "draft");

    try {
      expect((await post(batch(made.placeIds))).status).toBe(404);
      expect(await rowsOf(explorerA.id, made.placeIds[0]!)).toBe(0);
    } finally {
      await f.setStatus(curActor, made.collectionId, "published");
    }

    expect((await post(batch(made.placeIds))).status).toBe(201);
  });

  it("a repeated batch adds nothing and says so (one past visit per place)", async () => {
    state.session = a;

    const [p1, p2] = await places(2);

    expect(await (await post(batch([p1!]))).json()).toEqual({ recorded: 1, alreadyVisited: 0 });
    // The same place again, with another date, plus a new one.
    const again = await post(batch([p1!, p2!], { precision: "year", value: "2018" }));

    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ recorded: 1, alreadyVisited: 1 });
    expect(await rowsOf(explorerA.id, p1!)).toBe(1);
    expect(await rowsOf(explorerA.id, p2!)).toBe(1);
    // The first date stays.
    const [row] = await f.admin$<{ visited_on: string }>(
      `select visited_on::text from public.visits where user_id = $1 and place_id = $2`,
      [explorerA.id, p1],
    );

    expect(row!.visited_on).toBe("2019-03-01");
  });

  it("merges the same place listed twice in one batch", async () => {
    state.session = a;

    const [place] = await places(1);

    expect(await (await post(batch([place!, place!.toUpperCase()]))).json()).toEqual({
      recorded: 1,
      alreadyVisited: 0,
    });
    expect(await rowsOf(explorerA.id, place!)).toBe(1);
  });

  it("two parallel batches of one explorer leave one row per place", async () => {
    state.session = b;
    state.app = wide;

    const ids = await places(5);
    const responses = await Promise.all([
      post(batch(ids)),
      post(batch(ids)),
      post(batch([...ids].reverse())),
    ]);

    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);

    const bodies = (await Promise.all(responses.map((r) => r.json()))) as {
      recorded: number;
      alreadyVisited: number;
    }[];

    expect(bodies.reduce((sum, body) => sum + body.recorded, 0)).toBe(5);
    for (const id of ids) {
      expect(await rowsOf(explorerB.id, id, "past")).toBe(1);
    }
  });

  it("skips a place already confirmed on site, and a later on-site confirmation still works after a past visit", async () => {
    state.session = a;

    const [confirmed, remembered] = await places(2);
    const record = (placeId: string) =>
      f.as(a, `select result from public.record_on_site_visit(?::uuid, 54.0, 18.0, 10, ?::uuid)`, [
        placeId,
        randomUUID(),
      ]);

    // Confirmed on site first: the past mark adds nothing.
    expect((await record(confirmed!))[0]).toEqual({ result: "recorded" });
    expect(await (await post(batch([confirmed!]))).json()).toEqual({
      recorded: 0,
      alreadyVisited: 1,
    });
    expect(await rowsOf(explorerA.id, confirmed!, "past")).toBe(0);

    // Past first: the explorer can still confirm on site later (D-10).
    expect((await post(batch([remembered!]))).status).toBe(201);
    expect((await record(remembered!))[0]).toEqual({ result: "recorded" });
    expect(await rowsOf(explorerA.id, remembered!, "past")).toBe(1);
    expect(await rowsOf(explorerA.id, remembered!, "on_site")).toBe(1);
    expect(await getMyVisitOfPlace(a, remembered!, deps())).toEqual({
      status: "ok",
      value: { onSite: true, past: { precision: "month", visitedOn: "2019-03-01" } },
    });
  });

  it("raises the progress of the collection", async () => {
    state.session = b;

    const made = await f.publishedCollection(curActor, organizationId, 3);

    expect((await post(batch(made.placeIds.slice(0, 2)))).status).toBe(201);

    const visited = await runInUserContext(app.em, b, (tx) =>
      postgresAlbumRepository.listVisitedPlaceIdsOfCollection(tx, made.collectionId),
    );

    expect([...visited].sort()).toEqual(made.placeIds.slice(0, 2).sort());

    const kinds = await runInUserContext(app.em, b, (tx) =>
      postgresVisitRepository.listMyVisitKindsOfCollection(tx, made.collectionId),
    );

    expect(kinds).toHaveLength(2);
    expect(kinds.every((k) => k.kind === "past")).toBe(true);
  });

  it("A does not see, and cannot remove, the visits of B, and the curator sees none (R-09)", async () => {
    const [place] = await places(1);

    state.session = b;
    expect((await post(batch([place!]))).status).toBe(201);

    // Raw SQL as the application role: another explorer and the curator see nothing.
    for (const actor of [a, curActor]) {
      expect(
        (
          await f.as(actor, `select count(*)::int as n from public.visits where place_id = ?`, [
            place,
          ])
        )[0]!.n,
      ).toBe(0);
      expect(
        await f.as(actor, `delete from public.visits where place_id = ? returning id`, [place]),
      ).toEqual([]);
    }

    // The route: A removes nothing of B's.
    state.session = a;
    expect((await del(place!)).status).toBe(204);
    expect(await rowsOf(explorerB.id, place!, "past")).toBe(1);
  });

  it("DELETE removes only the own past visit of the place, and never an on-site one", async () => {
    state.session = a;

    const [place, other] = await places(2);

    expect((await post(batch([place!, other!]))).status).toBe(201);
    await f.as(
      a,
      `select result from public.record_on_site_visit(?::uuid, 54.0, 18.0, 10, ?::uuid)`,
      [place, randomUUID()],
    );

    expect((await del(place!)).status).toBe(204);
    expect(await rowsOf(explorerA.id, place!, "past")).toBe(0);
    expect(await rowsOf(explorerA.id, place!, "on_site")).toBe(1);
    expect(await rowsOf(explorerA.id, other!, "past")).toBe(1);
    // Nothing to remove is not an error; a malformed id is not found.
    expect((await del(place!)).status).toBe(204);
    expect((await del("nope")).status).toBe(404);
  });

  it("answers 400 for more than 100 places, an empty list and a body of the wrong shape", async () => {
    state.session = a;

    const ids = Array.from({ length: 101 }, () => randomUUID());
    const before = await allRowsOf(explorerA.id);

    expect((await post(batch(ids))).status).toBe(400);
    expect((await post(batch([]))).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ placeIds: ["nope"], date: month })).status).toBe(400);
    expect(await allRowsOf(explorerA.id)).toBe(before);
  });

  it("answers 400 for a future date, a date before 1900 and a value that does not match the precision", async () => {
    state.session = a;

    const [place] = await places(1);
    // Two years ahead is in the future in Europe/Warsaw whatever the UTC clock
    // says, also on New Year's Eve after 23:00 UTC.
    const futureYear = String(new Date().getUTCFullYear() + 2);

    for (const date of [
      { precision: "day", value: `${futureYear}-01-01` },
      { precision: "year", value: futureYear },
      { precision: "day", value: "1899-12-31" },
      { precision: "day", value: "2019-02-31" },
      { precision: "month", value: "2019-03-12" },
      { precision: "unknown", value: "2019" },
      { precision: "week", value: "2019" },
    ]) {
      expect((await post(batch([place!], date))).status).toBe(400);
    }
    expect(await rowsOf(explorerA.id, place!)).toBe(0);
  });

  it("answers 413 for a body over 64 KB", async () => {
    state.session = a;

    const [place] = await places(1);

    expect((await post({ ...batch([place!]), padding: "x".repeat(70_000) })).status).toBe(413);
    expect(await rowsOf(explorerA.id, place!)).toBe(0);
  });

  it("answers 429 over the limit and records nothing", async () => {
    state.session = a;
    state.allow = false;

    const [place] = await places(1);
    const response = await post(batch([place!]));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect((await del(place!)).status).toBe(429);
    expect(await rowsOf(explorerA.id, place!)).toBe(0);
  });

  it("leaves no actor on the connection: outside any transaction the setting is empty and no visit is visible", async () => {
    state.session = a;

    const [place] = await places(1);

    expect((await post(batch([place!]))).status).toBe(201);
    expect(await rowsOf(explorerA.id, place!, "past")).toBe(1);

    // The pool has ONE connection and these statements run on it outside a
    // transaction, without the guest context (which would clear the setting
    // itself): a leaked `app.user_id` would be seen here.
    const connection = app.em.getConnection();
    const setting = await connection.execute<{ u: string | null }[]>(
      `select nullif(current_setting('app.user_id', true), '') as u`,
    );
    const visible = await connection.execute<{ n: number }[]>(
      `select count(*)::int as n from public.visits`,
    );

    // No session-level advisory lock is left either (the batch uses a transaction-level one).
    const locks = await connection.execute<{ n: number }[]>(
      `select count(*)::int as n from pg_locks
        where pid = pg_backend_pid() and locktype = 'advisory'`,
    );

    expect(setting[0]!.u).toBeNull();
    expect(visible[0]!.n).toBe(0);
    expect(locks[0]!.n).toBe(0);
  });

  it("a batch waits for the advisory lock of the explorer and then adds nothing for a place recorded meanwhile", async () => {
    state.session = a;
    state.app = wide;

    const [place] = await places(1);
    let batchPromise: ReturnType<typeof post> | undefined;
    let waiting = false;

    // The test holds the same lock a batch takes. A batch started now must
    // wait for it; the test records the place in the meantime and commits. The
    // batch then sees that visit and adds nothing. Without the lock it would
    // not wait and would add its own row first.
    // A raw connection of krajozbior_app, so the batch is not started inside
    // this transaction (MikroORM would see it and refuse a nested context).
    await withClient(db.urls.krajozbior_app, async (client) => {
      await client.query("begin");
      await client.query("select set_config('app.user_id', $1, true)", [explorerA.id]);
      await client.query(
        `select pg_advisory_xact_lock(
           hashtextextended('visits_past:' || app_current_user_id()::text, 0))`,
      );
      batchPromise = post(batch([place!], { precision: "year", value: "2018" }));

      for (let i = 0; i < 100 && !waiting; i += 1) {
        waiting =
          Number(
            (
              await f.admin$<{ n: string }>(
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

      await client.query(
        `insert into public.visits (user_id, place_id, kind, visited_on, date_precision)
         values (app_current_user_id(), $1, 'past', '2017-06-01', 'month')`,
        [place],
      );
      await client.query("commit");
    });

    expect(waiting).toBe(true);

    const response = await batchPromise!;

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ recorded: 0, alreadyVisited: 1 });
    expect(await rowsOf(explorerA.id, place!, "past")).toBe(1);

    const [row] = await f.admin$<{ visited_on: string }>(
      `select visited_on::text from public.visits where user_id = $1 and place_id = $2`,
      [explorerA.id, place],
    );

    expect(row!.visited_on).toBe("2017-06-01");
  });

  it("answers 404 and writes nothing for a place of a suspended organization", async () => {
    state.session = a;

    const suspendedOrganization = await f.newOrganization(
      "Gmina Zawieszona Wizyt",
      "gmina-zawieszona-wizyt",
      [cur],
    );
    const made = await f.publishedCollection(curActor, suspendedOrganization, 2);

    expect((await post(batch(made.placeIds))).status).toBe(201);
    await f.admin$(`delete from public.visits where user_id = $1`, [explorerA.id]);
    await f.suspendOrganization(suspendedOrganization);

    try {
      expect((await post(batch(made.placeIds))).status).toBe(404);
      expect((await post(batch([made.placeIds[0]!]))).status).toBe(404);
      for (const id of made.placeIds) {
        expect(await rowsOf(explorerA.id, id)).toBe(0);
      }
    } finally {
      await f.approveOrganization(suspendedOrganization);
    }

    expect((await post(batch(made.placeIds))).status).toBe(201);
  });
});
