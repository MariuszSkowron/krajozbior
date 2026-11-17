import { randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DATE_PRECISIONS, VISIT_KINDS } from "@/features/visits/domain/visit-outcome";
import { createOrmConfig } from "@/lib/db/config";
import { albumFixtures, newUser, rejectedByPolicy } from "../support/album-fixtures";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// E2, PR5: visits and record_on_site_visit() on the real database
// (docs/data-isolation.md, class PRIV; spec D-T3, checklist of nine points).
// `app` is a pooled connection as krajozbior_app (max 1 connection).
const FUNCTION =
  "public.record_on_site_visit(uuid, double precision, double precision, double precision, uuid)";

let db: ScratchDatabase;
let app: MikroORM;

const explorerA = newUser("explorer-a");
const explorerB = newUser("explorer-b");
const curA = newUser("cur-a"); // member of orgA, owner of the places
const curS = newUser("cur-s"); // member of orgS (suspended in a test)

let orgA = "";
let orgS = "";
let place = ""; // 54.0, 18.0, radius 200 m, in a published collection of orgA
let otherPlace = ""; // the same, another place
let draftPlace = ""; // only in a draft collection of orgA

const f = albumFixtures({ db: () => db, app: () => app });
const { admin$, as, asGuest } = f;

const EARTH_RADIUS_M = 6_371_008.8;
const LAT = 54.0;
const LON = 18.0;
// A point `metres` north of the place (haversine along a meridian is exact).
const north = (metres: number) => LAT + ((metres / EARTH_RADIUS_M) * 180) / Math.PI;

type Row = { result: string; distance_m: number | null };

const record = (
  actor: { id: string },
  placeId: string,
  options: { lat?: number; lon?: number; accuracy?: number; clientVisitId?: string } = {},
) =>
  as(
    actor,
    `select * from public.record_on_site_visit(?::uuid, ?::float8, ?::float8, ?::float8, ?::uuid)`,
    [
      placeId,
      options.lat ?? LAT,
      options.lon ?? LON,
      options.accuracy ?? 10,
      options.clientVisitId ?? randomUUID(),
    ],
  ) as Promise<Row[]>;

const visitCount = async (userId: string, placeId?: string) =>
  Number(
    (
      await admin$<{ n: string }>(
        `select count(*) as n from public.visits where user_id = $1 and ($2::uuid is null or place_id = $2)`,
        [userId, placeId ?? null],
      )
    )[0]!.n,
  );

const markPast = (actor: { id: string }, placeId: string) =>
  as(
    actor,
    `insert into public.visits (user_id, place_id, kind, date_precision)
     values (app_current_user_id(), ?, 'past', 'unknown') returning id`,
    [placeId],
  );

describe("visits and the visit function", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_visits");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, curA, curS]);
    orgA = await f.newOrganization("Gmina A", "gmina-a", [curA]);
    orgS = await f.newOrganization("Gmina S", "gmina-s", [curS]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
    const published = await f.publishedCollection(curA, orgA, 2);

    place = published.placeIds[0]!;
    otherPlace = published.placeIds[1]!;
    draftPlace = (await f.draftCollection(curA, orgA)).placeIds[0]!;
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  describe("the table", () => {
    it("has row security enabled, forced and policies, and a safe app role", async () => {
      const gaps = await withClient(db.adminUrl, async (client) => [
        ...(await findRowLevelSecurityGaps(client, ["public.visits"])),
        ...(await findApplicationRoleGaps(client)),
      ]);

      expect(gaps).toEqual([]);
    });

    it("gives krajozbior_app select, insert and delete only, and no other role anything", async () => {
      const [p] = await admin$<Record<string, boolean>>(
        `select
           has_table_privilege('krajozbior_app', 'visits', 'select, insert, delete') as app_ok,
           has_table_privilege('krajozbior_app', 'visits', 'update, truncate, references, trigger') as app_bad,
           has_any_column_privilege('krajozbior_app', 'visits', 'update') as app_update,
           has_any_column_privilege('krajozbior_auth', 'visits', 'select, insert, update') as auth_any,
           has_any_column_privilege('krajozbior_ops', 'visits', 'select, insert, update') as ops_any`,
      );

      expect(p).toEqual({
        app_ok: true,
        app_bad: false,
        app_update: false,
        auth_any: false,
        ops_any: false,
      });
    });

    it("stores no position and no accuracy, only the place, the server time and the kind (D-14)", async () => {
      const columns = await admin$<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'visits' order by ordinal_position`,
      );

      expect(columns.map(({ column_name }) => column_name)).toEqual([
        "id",
        "user_id",
        "place_id",
        "kind",
        "visited_at",
        "visited_on",
        "date_precision",
        "client_visit_id",
        "created_at",
      ]);
    });

    it("keeps the frozen CHECK lists in step with the code", async () => {
      const listOf = async (column: string) => {
        const rows = await admin$<{ def: string }>(
          `select pg_get_constraintdef(c.oid) as def
             from pg_constraint c
            where c.conrelid = 'public.visits'::regclass and c.contype = 'c'`,
        );
        const found = rows.find(({ def }) => def.includes(`(${column} = ANY`));

        return [...(found?.def.matchAll(/'([a-z_]+)'::text/g) ?? [])].map((match) => match[1]);
      };

      expect(await listOf("kind")).toEqual([...VISIT_KINDS]);
      expect(await listOf("date_precision")).toEqual([...DATE_PRECISIONS]);
    });

    it("enforces the CHECK constraints (checked as the superuser, who skips row policies)", async () => {
      const insert = (
        kind: string,
        precision: string | null,
        clientVisitId: string | null,
        on: string | null = null,
      ) =>
        admin$(
          `insert into public.visits (user_id, place_id, kind, date_precision, client_visit_id, visited_on)
           values ($1, $2, $3, $4, $5, $6)`,
          [explorerA.id, place, kind, precision, clientVisitId, on],
        );

      // V4: a visit on site always has a client_visit_id.
      await expect(insert("on_site", null, null)).rejects.toThrow(/visits_client_visit_id_check/);
      // A visit on site has no date precision; a past visit has one.
      await expect(insert("on_site", "day", randomUUID(), "2024-01-01")).rejects.toThrow(
        /visits_date_precision_kind_check/,
      );
      await expect(insert("past", null, null)).rejects.toThrow(/visits_date_precision_kind_check/);
      // A date comes with a precision other than "unknown", and only then.
      await expect(insert("past", "day", null, null)).rejects.toThrow(
        /visits_visited_on_precision_check/,
      );
      await expect(insert("past", "unknown", null, "2024-01-01")).rejects.toThrow(
        /visits_visited_on_precision_check/,
      );
      await expect(insert("holiday", null, randomUUID())).rejects.toThrow(/check constraint/);
      await expect(insert("past", "week", null)).rejects.toThrow(/check constraint/);
      expect(await visitCount(explorerA.id)).toBe(0);
    });

    it("shows nothing and accepts no write without a user context", async () => {
      expect(await asGuest(`select * from public.visits`)).toEqual([]);
      await expect(
        app.em.execute(
          `insert into public.visits (user_id, place_id, kind, date_precision) values (?, ?, 'past', 'unknown')`,
          [explorerA.id, place],
        ),
      ).rejects.toThrow(rejectedByPolicy);
    });
  });

  describe("raw inserts by krajozbior_app", () => {
    it("refuses a visit on site: only the function creates it", async () => {
      await expect(
        as(
          explorerA,
          `insert into public.visits (user_id, place_id, kind, client_visit_id)
           values (app_current_user_id(), ?, 'on_site', ?)`,
          [place, randomUUID()],
        ),
      ).rejects.toThrow(rejectedByPolicy);
      expect(await visitCount(explorerA.id)).toBe(0);
    });

    it("accepts a past visit for a publicly visible place, and the function is not blocked by the past-only policy", async () => {
      expect(await markPast(explorerA, place)).toHaveLength(1);
      expect(await record(explorerA, place)).toEqual([{ result: "recorded", distance_m: 0 }]);
      expect(
        await admin$<{ kind: string }>(
          `select kind from public.visits where user_id = $1 and place_id = $2 order by kind`,
          [explorerA.id, place],
        ),
      ).toEqual([{ kind: "on_site" }, { kind: "past" }]);
    });

    it("refuses a past visit in a place that is only in a draft, also to a member of its organization (W2)", async () => {
      await expect(markPast(explorerA, draftPlace)).rejects.toThrow(rejectedByPolicy);
      await expect(markPast(curA, draftPlace)).rejects.toThrow(rejectedByPolicy);
      await expect(markPast(explorerA, randomUUID())).rejects.toThrow(rejectedByPolicy);
    });

    it("refuses a visit for another user than the actor", async () => {
      await expect(
        as(
          explorerA,
          `insert into public.visits (user_id, place_id, kind, date_precision) values (?, ?, 'past', 'unknown')`,
          [explorerB.id, place],
        ),
      ).rejects.toThrow(rejectedByPolicy);
    });
  });

  describe("explorer A against explorer B, and curators (R-09)", () => {
    it("keeps visits private, also for raw SQL, and lets only the owner delete", async () => {
      const [{ id }] = (await markPast(explorerA, otherPlace)) as { id: string }[];

      expect(await as(explorerA, `select id from public.visits where id = ?`, [id])).toHaveLength(
        1,
      );
      expect(await as(explorerB, `select * from public.visits where id = ?`, [id])).toEqual([]);
      expect(
        await as(explorerB, `select * from public.visits where user_id = ?`, [explorerA.id]),
      ).toEqual([]);
      expect(
        await as(explorerB, `delete from public.visits where id = ? returning id`, [id]),
      ).toEqual([]);
      await expect(as(explorerA, `update public.visits set kind = 'past'`)).rejects.toThrow(
        /permission denied/,
      );
      expect(
        await as(explorerA, `delete from public.visits where id = ? returning id`, [id]),
      ).toHaveLength(1);
    });

    it("shows a curator no visit at all, even a member of the organization of the place", async () => {
      await record(explorerA, place);
      await markPast(explorerB, place);

      expect(await visitCount(explorerA.id, place)).toBeGreaterThan(0);
      expect(await as(curA, `select * from public.visits`)).toEqual([]);
      expect(await as(curS, `select * from public.visits`)).toEqual([]);
      expect(await as(curA, `delete from public.visits returning id`)).toEqual([]);
      await expect(
        as(curA, `select count(*) from public.visits v join public.places p on p.id = v.place_id`),
      ).resolves.toEqual([{ count: "0" }]);
    });
  });

  describe("record_on_site_visit: the checklist of D-T3", () => {
    it("(1) refuses a guest and writes nothing", async () => {
      const before = await visitCount(explorerA.id);

      await expect(
        asGuest(`select * from public.record_on_site_visit(?::uuid, 54, 18, 10, ?::uuid)`, [
          place,
          randomUUID(),
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.em.execute(`select * from public.record_on_site_visit(?::uuid, 54, 18, 10, ?::uuid)`, [
          place,
          randomUUID(),
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      expect(await visitCount(explorerA.id)).toBe(before);
    });

    it("(2, 4) takes no user id, is a security definer of the owner, and pins search_path", async () => {
      const [fn] = await admin$<{
        args: string;
        definer: boolean;
        owner: string;
        config: string[];
        volatility: string;
      }>(
        `select pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer,
                pg_get_userbyid(p.proowner) as owner, p.proconfig as config, p.provolatile as volatility
           from pg_proc p where p.oid = '${FUNCTION}'::regprocedure`,
      );

      expect(fn!.args).not.toMatch(/user/);
      expect(fn!.definer).toBe(true);
      expect(fn!.owner).toBe("krajozbior_owner");
      expect(fn!.volatility).toBe("v");
      // pg_temp last.
      expect(fn!.config).toEqual(["search_path=pg_catalog, public, pg_temp"]);
    });

    it("(3) rejects invalid input with 22023: null, NaN, infinity and out of range, for every parameter", async () => {
      const bad = async (sql: string) => {
        await expect(
          as(explorerA, `select * from public.record_on_site_visit(${sql})`),
        ).rejects.toMatchObject({
          code: "22023",
        });
      };
      const id = `'${place}'::uuid`;
      const cv = `'${randomUUID()}'::uuid`;

      // null in each parameter
      await bad(`null::uuid, 54, 18, 10, ${cv}`);
      await bad(`${id}, null::float8, 18, 10, ${cv}`);
      await bad(`${id}, 54, null::float8, 10, ${cv}`);
      await bad(`${id}, 54, 18, null::float8, ${cv}`);
      await bad(`${id}, 54, 18, 10, null::uuid`);
      // NaN and infinity in each number
      for (const value of ["'NaN'", "'Infinity'", "'-Infinity'"]) {
        await bad(`${id}, ${value}::float8, 18, 10, ${cv}`);
        await bad(`${id}, 54, ${value}::float8, 10, ${cv}`);
        await bad(`${id}, 54, 18, ${value}::float8, ${cv}`);
      }
      // out of range
      await bad(`${id}, 90.0001, 18, 10, ${cv}`);
      await bad(`${id}, -90.0001, 18, 10, ${cv}`);
      await bad(`${id}, 54, 180.0001, 10, ${cv}`);
      await bad(`${id}, 54, -180.0001, 10, ${cv}`);
      await bad(`${id}, 54, 18, -0.1, ${cv}`);
      await bad(`${id}, 54, 18, 100000.1, ${cv}`);
    });

    it("(3, 9) accepts the edges of the ranges and puts no value into an error message", async () => {
      expect(await record(explorerA, place, { lat: 90, lon: 180, accuracy: 100_000 })).toEqual([
        { result: "inaccurate", distance_m: null },
      ]);
      expect(await record(explorerA, place, { lat: -90, lon: -180, accuracy: 0 })).toHaveLength(1);

      const error = await as(
        explorerA,
        `select * from public.record_on_site_visit(?::uuid, 91.123456, 18.654321, 10, ?::uuid)`,
        [place, randomUUID()],
      ).catch((caught: Error) => caught);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toMatch(/91\.123456|18\.654321/);
    });

    it("(5) is executable for krajozbior_app only", async () => {
      const [p] = await admin$<Record<string, boolean>>(
        `select
           has_function_privilege('krajozbior_app', '${FUNCTION}', 'execute') as app,
           has_function_privilege('krajozbior_ops', '${FUNCTION}', 'execute') as ops,
           has_function_privilege('krajozbior_auth', '${FUNCTION}', 'execute') as auth,
           coalesce((select bool_or(a.grantee = 0)
                       from pg_proc p, aclexplode(p.proacl) a
                      where p.oid = '${FUNCTION}'::regprocedure), false) as public`,
      );

      expect(p).toEqual({ app: true, ops: false, auth: false, public: false });
    });

    it("(6) is idempotent: a repeated client_visit_id gives the same answer and no second row", async () => {
      const clientVisitId = randomUUID();
      const before = await visitCount(explorerA.id, otherPlace);

      expect(await record(explorerA, otherPlace, { clientVisitId })).toEqual([
        { result: "recorded", distance_m: 0 },
      ]);
      expect(await record(explorerA, otherPlace, { clientVisitId })).toEqual([
        { result: "recorded", distance_m: 0 },
      ]);
      expect(await visitCount(explorerA.id, otherPlace)).toBe(before + 1);

      // The same id for another place is an error, and adds nothing.
      await expect(record(explorerA, place, { clientVisitId })).rejects.toMatchObject({
        code: "22023",
      });
      expect(await visitCount(explorerA.id, otherPlace)).toBe(before + 1);
    });

    it("(6) keeps the client_visit_id of one user from touching another's visits", async () => {
      const clientVisitId = randomUUID();

      await record(explorerA, place, { clientVisitId });
      // B uses the same id: a row of its own, A's row is not seen, not changed.
      expect(await record(explorerB, place, { clientVisitId })).toEqual([
        { result: "recorded", distance_m: 0 },
      ]);
      expect(
        await admin$(`select user_id from public.visits where client_visit_id = $1`, [
          clientVisitId,
        ]),
      ).toHaveLength(2);
    });

    it("(7) answers not_found for a place only in a draft, also for a member of its organization", async () => {
      const row = [{ result: "not_found", distance_m: null }];
      const before = await visitCount(curA.id);

      expect(await record(explorerA, draftPlace)).toEqual(row);
      expect(await record(curA, draftPlace)).toEqual(row);
      expect(await record(explorerA, randomUUID())).toEqual(row);
      expect(await visitCount(curA.id)).toBe(before);
    });

    it("(7, 8, M-1) answers not_found while the collection is withdrawn or the organization suspended, and works again after", async () => {
      const { collectionId, placeIds } = await f.publishedCollection(curS, orgS);
      const row = [{ result: "not_found", distance_m: null }];

      expect(await record(explorerA, placeIds[0]!)).toEqual([
        { result: "recorded", distance_m: 0 },
      ]);

      await f.setStatus(curS, collectionId, "draft");
      expect(await record(explorerA, placeIds[0]!)).toEqual(row);
      await f.setStatus(curS, collectionId, "published");
      expect(await record(explorerA, placeIds[0]!)).toHaveLength(1);

      // The owner policy of PR1 on organizations is using (true), so only the
      // explicit organizations.status filter in the function hides the place.
      await f.suspendOrganization(orgS);
      try {
        expect(await record(explorerA, placeIds[0]!)).toEqual(row);
        expect(await record(curS, placeIds[0]!)).toEqual(row);
      } finally {
        await f.approveOrganization(orgS);
      }
      expect((await record(explorerA, placeIds[0]!))[0]!.result).toBe("recorded");
    });

    it("(8) lets the function read nothing but what it needs: the owner policies are narrow", async () => {
      const [{ n }] = await admin$<{ n: string }>(
        `select count(*) as n from pg_policies
          where schemaname = 'public' and 'krajozbior_owner' = any (roles)
            and tablename in ('collections', 'collection_places', 'places', 'visits')`,
      );

      // collections, collection_places, places: SELECT; visits: SELECT and INSERT.
      expect(Number(n)).toBe(5);
      const visitPolicies = await admin$<{ cmd: string; with_check: string | null }>(
        `select cmd, with_check from pg_policies
          where tablename = 'visits' and 'krajozbior_owner' = any (roles) order by cmd`,
      );

      expect(visitPolicies.map(({ cmd }) => cmd)).toEqual(["INSERT", "SELECT"]);
      expect(visitPolicies[0]!.with_check).toContain("on_site");
    });

    it("(9) writes no position anywhere: the recorded row holds only the place, the time and the kind", async () => {
      const clientVisitId = randomUUID();

      await record(explorerA, place, { lat: north(50), accuracy: 33.3, clientVisitId });

      const [row] = await admin$<Record<string, unknown>>(
        `select * from public.visits where client_visit_id = $1`,
        [clientVisitId],
      );

      expect(row).toMatchObject({
        user_id: explorerA.id,
        place_id: place,
        kind: "on_site",
        visited_on: null,
        date_precision: null,
      });
      expect(JSON.stringify(row)).not.toMatch(/33\.3|54\.0|18\.0/);
      expect(Math.abs(new Date(row!.visited_at as string).getTime() - Date.now())).toBeLessThan(
        60_000,
      );
    });
  });

  describe("distance and accuracy", () => {
    const tight = async () => {
      // A place of its own with the smallest radius (50 m) for sharp edges.
      const made = await f.publishedCollection(curA, orgA, 1);

      await admin$(`update public.places set visit_radius_m = 50 where id = $1`, [
        made.placeIds[0],
      ]);

      return made.placeIds[0]!;
    };

    it("records inside the radius and refuses outside it, with the distance rounded up (about 199 / 200 / 201 m)", async () => {
      const before = await visitCount(explorerB.id, place);

      expect(await record(explorerB, place, { lat: north(198.5) })).toEqual([
        { result: "recorded", distance_m: 199 },
      ]);
      expect(await record(explorerB, place, { lat: north(199.9) })).toEqual([
        { result: "recorded", distance_m: 200 },
      ]);
      expect(await visitCount(explorerB.id, place)).toBe(before + 2);

      // 200.4 m is outside a 200 m radius, and reads as 201 m, never as 200.
      expect(await record(explorerB, place, { lat: north(200.4) })).toEqual([
        { result: "out_of_range", distance_m: 201 },
      ]);
      expect((await record(explorerB, place, { lat: north(201) }))[0]).toMatchObject({
        result: "out_of_range",
      });
      expect(await record(explorerB, place, { lat: north(6200) })).toEqual([
        { result: "out_of_range", distance_m: 6200 },
      ]);
      expect(await visitCount(explorerB.id, place)).toBe(before + 2);
    });

    it("follows the radius of the place, not a constant (50 m)", async () => {
      const placeId = await tight();

      expect((await record(explorerB, placeId, { lat: north(49) }))[0]!.result).toBe("recorded");
      expect(await record(explorerB, placeId, { lat: north(60) })).toEqual([
        { result: "out_of_range", distance_m: 60 },
      ]);
    });

    it("measures in both axes (a point east of the place)", async () => {
      // 100 m east at latitude 54: delta longitude = d / (R cos(lat)) in degrees.
      const dLon = ((100 / (EARTH_RADIUS_M * Math.cos((LAT * Math.PI) / 180))) * 180) / Math.PI;
      const [row] = await record(explorerB, place, { lon: LON + dLon });

      expect(row!.result).toBe("recorded");
      expect(row!.distance_m).toBeGreaterThanOrEqual(99);
      expect(row!.distance_m).toBeLessThanOrEqual(101);
    });

    it("accepts an accuracy up to 150 m and refuses a worse one, without a row (150 / 151 m)", async () => {
      const before = await visitCount(explorerB.id, otherPlace);

      expect(await record(explorerB, otherPlace, { accuracy: 150 })).toEqual([
        { result: "recorded", distance_m: 0 },
      ]);
      expect(await record(explorerB, otherPlace, { accuracy: 151 })).toEqual([
        { result: "inaccurate", distance_m: null },
      ]);
      expect(await record(explorerB, otherPlace, { accuracy: 5000, lat: north(5000) })).toEqual([
        { result: "inaccurate", distance_m: null },
      ]);
      expect(await visitCount(explorerB.id, otherPlace)).toBe(before + 1);
    });
  });

  it("does not leak the actor to the next transaction on the same connection", async () => {
    await record(explorerA, place);

    expect(await asGuest(`select * from public.visits`)).toEqual([]);
    expect(
      await as(explorerB, `select user_id from public.visits where user_id = ?`, [explorerA.id]),
    ).toEqual([]);
    expect(await app.em.execute(`select app_current_user_id() as id`, [], "get")).toEqual({
      id: null,
    });
  });
});
