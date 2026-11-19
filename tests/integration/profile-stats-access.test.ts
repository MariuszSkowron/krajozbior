import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { haversineKm } from "@/features/catalog/domain/nearby";
import { getMyStats } from "@/features/profile/application/stats";
import type { ProfileStatsDeps } from "@/features/profile/application/stats-types";
import { postgresProfileStatsRepository } from "@/features/profile/infrastructure/postgres-stats-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// E9-3: the statistics of the profile on the real database, as krajozbior_app on a pool of ONE
// connection (a leaked context would show). The statistics have no table of their own: they are
// counted from the private `visits` of the actor, so what is proved here is that nobody else's
// visits, no draft, no suspended organization and no nationwide collection enters the numbers,
// and that another person or a guest gets nothing of them.
let db: ScratchDatabase;
let app: MikroORM;

const explorerA = newUser("stats-a");
const explorerB = newUser("stats-b");
const curator = newUser("stats-curator");
const administrator = newUser("stats-admin");
const suspendedCurator = newUser("stats-suspended");

const f = albumFixtures({ db: () => db, app: () => app });
const { admin$, as } = f;

const deps = (): ProfileStatsDeps => ({
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  repository: postgresProfileStatsRepository,
});

const statsOf = async (user: { id: string }, role: "user" | "admin" = "user") => {
  const result = await getMyStats({ id: user.id, role }, deps());

  if (result.status !== "ok") {
    throw new Error(`stats answered ${result.status}`);
  }

  return result.value;
};

const place = (id: string, latitude: number, longitude: number) =>
  admin$(`update public.places set latitude = $2, longitude = $3 where id = $1`, [
    id,
    latitude,
    longitude,
  ]);

// A visit confirmed on site is written only by record_on_site_visit(); the superuser connection
// inserts the row with a chosen time, which is all these cases need.
const onSite = (user: { id: string }, placeId: string, at: string) =>
  admin$(
    `insert into public.visits (user_id, place_id, kind, client_visit_id, visited_at)
     values ($1, $2, 'on_site', gen_random_uuid(), $3)`,
    [user.id, placeId, at],
  );

const past = (user: { id: string }, placeId: string) =>
  as(
    user,
    `insert into public.visits (user_id, place_id, kind, date_precision)
     values (app_current_user_id(), ?, 'past', 'unknown')`,
    [placeId],
  );

const DEGREE_KM = haversineKm(0, 0, 0, 1);

let pomorskiePlaces: string[] = [];
let slaskiePlaces: string[] = [];
let slaskieCollection = "";
let orgMain = "";

describe("the statistics of the profile", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_profile_stats");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, curator, administrator, suspendedCurator]);
    orgMain = await f.newOrganization("Gmina Statystyk", "gmina-statystyk", [curator]);
    const orgSuspended = await f.newOrganization("Gmina Wstrzymana", "gmina-wstrzymana", [
      suspendedCurator,
    ]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });

    // C1: three places in "pomorskie"; C2: two places in "slaskie".
    const c1 = await f.publishedCollection(curator, orgMain, 3);
    const c2 = await f.publishedCollection(curator, orgMain, 2);

    pomorskiePlaces = c1.placeIds;
    slaskiePlaces = c2.placeIds;
    slaskieCollection = c2.collectionId;
    await admin$(`update public.collections set region = 'slaskie' where id = $1`, [
      slaskieCollection,
    ]);
    await place(pomorskiePlaces[0]!, 0, 0);
    await place(pomorskiePlaces[1]!, 0, 1);
    await place(pomorskiePlaces[2]!, 0, 3);
    await place(slaskiePlaces[0]!, 50, 19);
    await place(slaskiePlaces[1]!, 51, 19);

    // A draft place (never visible), and a place of an organization suspended after the visit.
    const draft = await f.draftCollection(curator, orgMain, 1);
    const suspended = await f.publishedCollection(suspendedCurator, orgSuspended, 1);

    await place(draft.placeIds[0]!, 10, 10);
    await place(suspended.placeIds[0]!, 20, 20);

    // Explorer A: two days on site (leg of one degree on the first day), one visit from the
    // past in another region, and visits that must not count.
    await onSite(explorerA, pomorskiePlaces[0]!, "2026-07-10T08:00:00Z");
    await onSite(explorerA, pomorskiePlaces[1]!, "2026-07-10T09:00:00Z");
    await onSite(explorerA, pomorskiePlaces[2]!, "2026-07-11T10:00:00Z");
    await past(explorerA, slaskiePlaces[0]!);
    await onSite(explorerA, suspended.placeIds[0]!, "2026-07-11T11:00:00Z");
    await admin$(`update public.organizations set status = 'suspended' where id = $1`, [
      orgSuspended,
    ]);
    // The visit to the draft place is inserted by the superuser: the application cannot make it.
    await onSite(explorerA, draft.placeIds[0]!, "2026-07-11T12:00:00Z");
    // A visit of B that would change A's numbers if the user filter were missing.
    await onSite(explorerB, pomorskiePlaces[0]!, "2026-07-10T08:00:00Z");
    await onSite(explorerB, slaskiePlaces[1]!, "2026-07-10T09:00:00Z");
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("counts places of both kinds, regions of the collections and the straight-line km of the days", async () => {
    const stats = await statsOf(explorerA);

    // P1, P2, P3 on site and Q1 from the past; the draft and suspended places are not public.
    expect(stats.visitedPlaces).toBe(4);
    expect(stats.regions).toBe(2);
    // Only the first day has a leg; the visit from the past and the day change add nothing.
    expect(stats.kmInTransit).toBeCloseTo(DEGREE_KM, 6);
  });

  it("does not let the visits of another explorer change the numbers", async () => {
    const before = await statsOf(explorerA);
    const b = await statsOf(explorerB);

    expect(b.visitedPlaces).toBe(2);
    expect(b.regions).toBe(2);
    expect(b.kmInTransit).toBeCloseTo(haversineKm(0, 0, 51, 19), 6);
    expect(await statsOf(explorerA)).toEqual(before);
  });

  it("gives zeros to a curator, an administrator and an explorer without visits", async () => {
    const zeros = { visitedPlaces: 0, regions: 0, kmInTransit: 0 };

    expect(await statsOf(curator)).toEqual(zeros);
    expect(await statsOf(administrator, "admin")).toEqual(zeros);
    expect(await statsOf(suspendedCurator)).toEqual(zeros);
  });

  it("answers a guest with unauthenticated and shows the repository nothing in a guest context", async () => {
    expect(await getMyStats(null, deps())).toEqual({ status: "unauthenticated" });

    const data = await runInGuestContext(app.em, (tx) =>
      postgresProfileStatsRepository.readVisitStats(tx),
    );

    expect(data).toEqual({ visitedPlaces: 0, regions: [], visits: [] });
  });

  it("does not read the visits of A in the context of B, even by raw SQL", async () => {
    const rows = await as(
      explorerB,
      `select count(*)::int as n from public.visits where user_id = ?`,
      [explorerA.id],
    );

    expect(rows[0]!.n).toBe(0);
  });

  it("adds no region for a place that only belongs to a nationwide collection (D-34)", async () => {
    // The catalog does not know `polska` yet, so the constraint of the scratch database is lifted
    // for this case only (it is the last one): the rule must hold the day the value appears.
    await admin$(`alter table public.collections drop constraint collections_region_check`);
    await admin$(`update public.collections set region = 'polska' where id = $1`, [
      slaskieCollection,
    ]);

    // A: Q1 (past) is only in the nationwide collection now: place still counts, region does not.
    const stats = await statsOf(explorerA);

    expect(stats.visitedPlaces).toBe(4);
    expect(stats.regions).toBe(1);

    // A place in both a nationwide and a regional collection adds the regional one.
    await admin$(
      `insert into public.collection_places (collection_id, place_id, organization_id, position)
       values ($1, $2, $3, 10)`,
      [slaskieCollection, pomorskiePlaces[0]!, orgMain],
    );
    expect((await statsOf(explorerA)).regions).toBe(1);
  });
});
