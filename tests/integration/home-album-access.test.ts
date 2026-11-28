import { randomInt } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AlbumDeps } from "@/features/album/application/album-types";
import { getHomeAlbum } from "@/features/album/application/home-album";
import { postgresAlbumRepository } from "@/features/album/infrastructure/postgres-album-repository";
import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { listRecentlyPublishedCollections } from "@/features/catalog/application/public-catalog";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// E12-1: the personal part of the home page (getHomeAlbum) and the public part
// (listRecentlyPublishedCollections) on the real database, as krajozbior_app on
// a pool of ONE connection, so a leaked context would show. Every case where the
// data is not public must give what a guest could see (D-E12-1a): a curator or an
// administrator sees in the personal sections nothing a guest would not.
let db: ScratchDatabase;
let app: MikroORM;

const explorerA = newUser("explorer-a");
const explorerB = newUser("explorer-b");
const curA = newUser("cur-a"); // member of orgA
const curS = newUser("cur-s"); // member of orgS (suspended in a test)
const curL = newUser("cur-l"); // member of orgL, which only has the limit test

let orgA = "";
let orgS = "";
let orgL = "";

const f = albumFixtures({ db: () => db, app: () => app });
const { admin$, as, asGuest } = f;

const albumDeps = (): AlbumDeps => ({
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresAlbumRepository,
});

const catalogDeps = (): CatalogDeps => ({
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  withGuestContext: (work) => runInGuestContext(app.em, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresCatalogRepository,
  random: (max) => randomInt(max),
});

async function homeOf(actor: { id: string }) {
  const result = await getHomeAlbum({ id: actor.id, role: "user" }, albumDeps());

  if (result.status !== "ok") {
    throw new Error(`home album answered ${result.status}`);
  }

  return result.value;
}

const save = (actor: { id: string }, collectionId: string) =>
  as(
    actor,
    `insert into public.saved_collections (user_id, collection_id)
     values (app_current_user_id(), ?)`,
    [collectionId],
  );

const pastVisit = (actor: { id: string }, placeId: string) =>
  as(
    actor,
    `insert into public.visits (user_id, place_id, kind, date_precision)
     values (app_current_user_id(), ?, 'past', 'unknown')`,
    [placeId],
  );

// A visit confirmed on site is written only by record_on_site_visit(); here the
// superuser connection inserts the row, which is all these cases need.
const onSiteVisit = (actor: { id: string }, placeId: string) =>
  admin$(
    `insert into public.visits (user_id, place_id, kind, client_visit_id)
     values ($1, $2, 'on_site', gen_random_uuid())`,
    [actor.id, placeId],
  );

const setRegion = (actor: { id: string }, collectionId: string, region: string) =>
  as(actor, `update public.collections set region = ? where id = ? returning id`, [
    region,
    collectionId,
  ]);

describe("home page: personal album and public collections", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_home_album");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, curA, curS, curL]);
    orgA = await f.newOrganization("Gmina A", "gmina-a", [curA]);
    orgS = await f.newOrganization("Gmina S", "gmina-s", [curS]);
    orgL = await f.newOrganization("Gmina L", "gmina-l", [curL]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("gives nothing to a guest: no actor is refused, and a guest sees no visit or save row", async () => {
    expect(await getHomeAlbum(null, albumDeps())).toEqual({ status: "unauthenticated" });
    expect(await asGuest(`select 1 from public.visits`)).toEqual([]);
    expect(await asGuest(`select 1 from public.saved_collections`)).toEqual([]);
  });

  it("is empty for a new explorer", async () => {
    const newcomer = newUser("newcomer");

    await f.insertUsers([newcomer]);
    expect(await homeOf(newcomer)).toEqual({
      summary: { discoveredPlaces: 0, regions: 0, savedCollections: 0 },
      favorites: [],
      recentVisits: [],
      homeReturn: { hasSaved: false, remaining: [], saveNudge: null },
    });
  });

  it("counts only own rows: explorer B sees nothing of explorer A in any section", async () => {
    const { collectionId, placeIds } = await f.publishedCollection(curA, orgA, 2);

    await save(explorerA, collectionId);
    await pastVisit(explorerA, placeIds[0]!);
    await onSiteVisit(explorerA, placeIds[1]!);

    const a = await homeOf(explorerA);

    expect(a.summary).toEqual({ discoveredPlaces: 2, regions: 1, savedCollections: 1 });
    expect(a.favorites).toEqual([
      expect.objectContaining({
        id: collectionId,
        progress: { kind: "progress", visited: 2, total: 2 },
      }),
    ]);
    expect(a.recentVisits.map((visit) => visit.kind)).toEqual(["on_site", "past"]);
    expect(a.homeReturn).toEqual({ hasSaved: true, remaining: [], saveNudge: null });
    expect(await homeOf(explorerB)).toEqual({
      summary: { discoveredPlaces: 0, regions: 0, savedCollections: 0 },
      favorites: [],
      recentVisits: [],
      homeReturn: { hasSaved: false, remaining: [], saveNudge: null },
    });
  });

  it("does not show a curator-owner a draft or a withdrawn saved collection of the own organization", async () => {
    // The curator saved the collection while it was public, then withdrew it; a draft exists too.
    const withdrawn = await f.publishedCollection(curA, orgA);

    await setRegion(curA, withdrawn.collectionId, "podlaskie");
    await save(curA, withdrawn.collectionId);
    await f.draftCollection(curA, orgA, 2);
    await pastVisit(curA, withdrawn.placeIds[0]!);
    await f.setStatus(curA, withdrawn.collectionId, "draft");

    // The row policies still show the curator both collections...
    expect(
      (await as(curA, `select id from public.collections where id = ?`, [withdrawn.collectionId]))
        .length,
    ).toBe(1);

    // ...but the home page shows what a guest would see.
    const home = await homeOf(curA);

    expect(home.favorites).toEqual([]);
    expect(home.summary.savedCollections).toBe(0);
    expect(home.summary.regions).toBe(0);
    // The visit stays (R-07): in the number, and in the list without name, address or link.
    expect(home.summary.discoveredPlaces).toBe(1);
    expect(home.recentVisits).toEqual([expect.objectContaining({ kind: "past", place: null })]);
  });

  it("does not show a saved collection of a suspended organization, and lists its visit as unavailable", async () => {
    const made = await f.publishedCollection(curS, orgS);

    await save(curS, made.collectionId);
    await pastVisit(curS, made.placeIds[0]!);
    expect((await homeOf(curS)).favorites).toHaveLength(1);

    await f.suspendOrganization(orgS);

    const home = await homeOf(curS);

    expect(home.favorites).toEqual([]);
    expect(home.summary).toEqual({ discoveredPlaces: 1, regions: 0, savedCollections: 0 });
    expect(home.recentVisits).toEqual([expect.objectContaining({ place: null })]);

    await f.approveOrganization(orgS);
  });

  it("drops a withdrawn saved collection from an explorer's favourites but keeps the visits", async () => {
    const made = await f.publishedCollection(curA, orgA);

    await save(explorerB, made.collectionId);
    await pastVisit(explorerB, made.placeIds[0]!);
    expect((await homeOf(explorerB)).favorites).toHaveLength(1);

    await f.setStatus(curA, made.collectionId, "draft");

    const home = await homeOf(explorerB);

    expect(home.favorites).toEqual([]);
    expect(home.summary).toEqual({ discoveredPlaces: 1, regions: 0, savedCollections: 0 });
    expect(home.recentVisits).toEqual([expect.objectContaining({ place: null })]);

    await f.setStatus(curA, made.collectionId, "published");
    expect((await homeOf(explorerB)).favorites).toHaveLength(1);
  });

  it("keeps the visit of a place removed from its collection in the number and in the list, also for the curator of its organization", async () => {
    // A fresh curator of orgA: the visits of curA from other cases would change the counts.
    const curR = newUser("cur-r");

    await f.insertUsers([curR]);
    await admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [orgA, curR.id],
    );

    const made = await f.publishedCollection(curR, orgA, 2);
    const [kept, removed] = made.placeIds as [string, string];
    const visitor = newUser("visitor");

    await f.insertUsers([visitor]);
    for (const who of [visitor, curR]) {
      await pastVisit(who, removed);
      await onSiteVisit(who, kept);
    }
    await as(
      curR,
      `delete from public.collection_places where collection_id = ? and place_id = ? returning 1`,
      [made.collectionId, removed],
    );

    for (const who of [visitor, curR]) {
      const home = await homeOf(who);

      // The curator may read the removed place through the row policies; the home page does not.
      expect(home.summary.discoveredPlaces).toBe(2);
      expect(home.recentVisits).toHaveLength(2);
      expect(home.recentVisits).toEqual([
        expect.objectContaining({ kind: "on_site", place: expect.objectContaining({ id: kept }) }),
        expect.objectContaining({ kind: "past", place: null }),
      ]);
    }
    expect((await as(curR, `select id from public.places where id = ?`, [removed])).length).toBe(1);
  });

  it("orders favourites by the later of the save and the last own visit, with at most 6 and 5 rows", async () => {
    const fan = newUser("fan");

    await f.insertUsers([fan]);

    const made: Awaited<ReturnType<typeof f.publishedCollection>>[] = [];

    for (let i = 0; i < 7; i += 1) {
      const collection = await f.publishedCollection(curL, orgL);

      await save(fan, collection.collectionId);
      made.push(collection);
    }

    // Visits after all saves: made[1..5] first, the oldest save (made[0]) last, so it
    // becomes the most recently used. made[6], saved last but never visited, is the 7th.
    for (const collection of made.slice(1, 6)) {
      await pastVisit(fan, collection.placeIds[0]!);
    }

    await onSiteVisit(fan, made[0]!.placeIds[0]!);

    const home = await homeOf(fan);

    expect(home.favorites).toHaveLength(6);
    expect(home.recentVisits).toHaveLength(5);
    expect(home.favorites.map((favorite) => favorite.id)).toEqual(
      [0, 5, 4, 3, 2, 1].map((index) => made[index]!.collectionId),
    );
    // The summary counts every saved public collection, not only the six shown.
    expect(home.summary.savedCollections).toBe(7);
  });

  it("counts a region once however many visited places and collections it has", async () => {
    const traveller = newUser("traveller");

    await f.insertUsers([traveller]);

    const first = await f.draftCollection(curL, orgL, 1);
    const second = await f.draftCollection(curL, orgL, 1);

    await setRegion(curL, second.collectionId, "podlaskie");
    await f.setStatus(curL, first.collectionId, "published");
    await f.setStatus(curL, second.collectionId, "published");
    await pastVisit(traveller, first.placeIds[0]!);
    await pastVisit(traveller, second.placeIds[0]!);

    expect((await homeOf(traveller)).summary.regions).toBe(2);
  });

  it("gives the public part the same list to a curator-owner of drafts and to a guest, newest publication first", async () => {
    const draft = await f.draftCollection(curA, orgA, 1);
    const fresh = await f.publishedCollection(curA, orgA, 2);

    // A read in the user context of the curator comes first on the same single connection.
    await as(curA, `select 1`);

    const seen = await listRecentlyPublishedCollections(6, catalogDeps());
    const again = await listRecentlyPublishedCollections(6, catalogDeps());

    expect(again).toEqual(seen);
    expect(seen.map((collection) => collection.id)).not.toContain(draft.collectionId);
    expect(seen.length).toBeLessThanOrEqual(6);
    expect(seen[0]).toEqual({
      id: expect.any(String),
      slug: expect.any(String),
      title: "Kolekcja",
      region: "pomorskie",
      extraRegions: [],
      organization: { name: expect.any(String) },
      placeCount: expect.any(Number),
      cover: null,
    });
    expect(seen.find((collection) => collection.id === fresh.collectionId)?.placeCount).toBe(2);

    // Same as a raw guest read: nothing that is not published by an approved organization.
    const raw = await asGuest(
      `select c.id from public.collections c join public.organizations o on o.id = c.organization_id
        where c.status = 'published' and o.status = 'approved'
        order by c.first_published_at desc, c.id limit 6`,
    );

    expect(seen.map((collection) => collection.id)).toEqual(raw.map((row) => row.id));
  });

  it("hides the collections of a suspended organization and clamps the limit", async () => {
    const made = await f.publishedCollection(curS, orgS);

    expect((await listRecentlyPublishedCollections(200, catalogDeps())).map((c) => c.id)).toContain(
      made.collectionId,
    );

    await f.suspendOrganization(orgS);
    expect(
      (await listRecentlyPublishedCollections(200, catalogDeps())).map((c) => c.id),
    ).not.toContain(made.collectionId);
    await f.approveOrganization(orgS);

    expect(await listRecentlyPublishedCollections(0, catalogDeps())).toHaveLength(1);
    expect(await listRecentlyPublishedCollections(Number.NaN, catalogDeps())).toHaveLength(1);
    expect(
      (await listRecentlyPublishedCollections(100000, catalogDeps())).length,
    ).toBeLessThanOrEqual(200);
  });
});
