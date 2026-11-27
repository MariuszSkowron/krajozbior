import { randomInt, randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AlbumDeps } from "@/features/album/application/album-types";
import { getHomeAlbum } from "@/features/album/application/home-album";
import { postgresAlbumRepository } from "@/features/album/infrastructure/postgres-album-repository";
import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import {
  getHomePublicReads,
  resetPlaceOfDayCache,
} from "@/features/catalog/application/public-catalog";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser, type TestUser } from "../support/album-fixtures";
import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// Powody do powrotu na Starcie (D-58 pkt 4): "Do odkrycia w Twoich kolekcjach" i zachęta do zapisu
// (dane własne odkrywcy, RLS, część albumu) oraz "Nowe kolekcje" i "Miejsce dnia" (dane publiczne,
// kontekst gościa), jako krajozbior_app na puli jednego połączenia. Odmowa: gość nie dostaje nic,
// odkrywca B nie widzi wizyt A, a wycofana kolekcja, kolekcja zawieszonej organizacji i ukryte
// zdjęcie nie pojawiają się nigdzie. Każdy test tworzy własnych odkrywców i własne kolekcje, więc
// testy nie zależą od kolejności (jedyny stan wspólny to pamięć "Miejsca dnia", czyszczona przed
// każdym testem).
let db: ScratchDatabase;
let app: MikroORM;

const curA = newUser("cur-a");
const curB = newUser("cur-b");

let orgA = "";
let orgB = "";

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

async function explorer(name: string): Promise<TestUser> {
  const user = newUser(`${name}-${randomUUID().slice(0, 8)}`);

  await f.insertUsers([user]);

  return user;
}

async function albumOf(actor: { id: string }) {
  const result = await getHomeAlbum({ id: actor.id, role: "user" }, albumDeps());

  if (result.status !== "ok") {
    throw new Error(`home album answered ${result.status}`);
  }

  return result.value;
}

const returnOf = async (actor: { id: string }) => (await albumOf(actor)).homeReturn;

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

const rename = (placeId: string, name: string) =>
  admin$(`update public.places set name = $2 where id = $1`, [placeId, name]);

const retitle = (collectionId: string, title: string) =>
  admin$(`update public.collections set title = $2 where id = $1`, [collectionId, title]);

const slugOf = async (collectionId: string) =>
  (
    await admin$<{ slug: string }>(`select slug from public.collections where id = $1`, [
      collectionId,
    ])
  )[0]!.slug;

async function describePlace(organizationId: string, placeId: string) {
  await admin$(
    `update public.places set description = 'Zamek nad rzeką. Drugie zdanie.' where id = $1`,
    [placeId],
  );
  const [{ id }] = await admin$<{ id: string }>(
    `insert into public.place_photos
       (organization_id, place_id, position, file_state, storage_key, width, height, alt_text,
        source_kind, title, author_text, source_url, license_code, license_url, license_label,
        rights_statement, commons_file)
     values ($1, $2, 1, 'ready', $3, 1600, 1067, 'Zamek', 'commons_import', 'Zamek',
             'Autor', 'https://commons.wikimedia.org/wiki/File:Zamek.jpg', 'cc-by-sa-3.0',
             'https://creativecommons.org/licenses/by-sa/3.0/pl/', 'CC BY-SA 3.0 PL',
             'commons-import/1', $4)
     returning id`,
    [organizationId, placeId, randomUUID(), `Zamek-${placeId}.jpg`],
  );

  return id;
}

describe("home page: reasons to return", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_home_return");
    await db.migrate();
    await f.insertUsers([curA, curB]);
    orgA = await f.newOrganization("Gmina A", "gmina-a", [curA]);
    orgB = await f.newOrganization("Gmina B", "gmina-b", [curB]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  beforeEach(() => {
    resetPlaceOfDayCache();
  });

  it("gives nothing to a guest: no actor is refused before any read", async () => {
    expect(await getHomeAlbum(null, albumDeps())).toEqual({ status: "unauthenticated" });
  });

  it("is empty for an explorer without visits or saves", async () => {
    expect(await returnOf(await explorer("new"))).toEqual({
      hasSaved: false,
      remaining: [],
      saveNudge: null,
    });
  });

  it("nudges to save a started collection, then lists what is left once it is saved", async () => {
    const a = await explorer("a");
    const { collectionId, placeIds } = await f.publishedCollection(curA, orgA, 3);

    await rename(placeIds[0]!, "Zamek");
    await rename(placeIds[1]!, "Młyn");
    await rename(placeIds[2]!, "Most");
    await retitle(collectionId, "Szlak nad rzeką");
    await pastVisit(a, placeIds[0]!);

    expect(await returnOf(a)).toEqual({
      hasSaved: false,
      remaining: [],
      saveNudge: expect.objectContaining({ id: collectionId, visited: 1, total: 3 }),
    });

    await save(a, collectionId);

    const after = await returnOf(a);

    expect(after.saveNudge).toBeNull();
    expect(after.hasSaved).toBe(true);
    // The visited place is left out; the rest follows the order of the list.
    expect(after.remaining).toEqual([
      {
        slug: await slugOf(collectionId),
        title: "Szlak nad rzeką",
        remaining: 2,
        names: ["Młyn", "Most"],
      },
    ]);
  });

  it("keeps explorer B out of the visits of explorer A, also for the same collection", async () => {
    const a = await explorer("a");
    const b = await explorer("b");
    const { collectionId, placeIds } = await f.publishedCollection(curA, orgA, 2);

    await pastVisit(a, placeIds[0]!);
    await pastVisit(a, placeIds[1]!);
    await save(a, collectionId);
    await save(b, collectionId);

    // B has no visit of their own: all places are left, and nothing is nudged.
    const forB = await returnOf(b);

    expect(forB.saveNudge).toBeNull();
    expect(forB.remaining).toEqual([expect.objectContaining({ remaining: 2 })]);
    // The same collection is complete for A: nothing is left and nothing is nudged.
    expect(await returnOf(a)).toEqual({ hasSaved: true, remaining: [], saveNudge: null });
  });

  it("finds an incomplete saved collection also when the six latest are complete", async () => {
    const a = await explorer("a");
    const open = await f.publishedCollection(curA, orgA, 2);

    await retitle(open.collectionId, "Starsza, nieukończona");
    // The oldest activity: saved first, one of two places visited.
    await save(a, open.collectionId);
    await pastVisit(a, open.placeIds[0]!);

    for (let i = 1; i <= 6; i += 1) {
      const done = await f.publishedCollection(curA, orgA, 1);

      await retitle(done.collectionId, `Ukończona ${i}`);
      await save(a, done.collectionId);
      await pastVisit(a, done.placeIds[0]!);
    }

    const album = await albumOf(a);

    // The six latest are complete and the older one is outside the six favourites...
    expect(album.favorites).toHaveLength(6);
    expect(album.favorites.map(({ title }) => title)).not.toContain("Starsza, nieukończona");
    expect(album.summary.savedCollections).toBe(7);
    // ...but it is still found, and "all complete" is not said.
    expect(album.homeReturn.remaining).toEqual([
      expect.objectContaining({ title: "Starsza, nieukończona", remaining: 1 }),
    ]);
  });

  it("counts a saved collection without places neither as complete nor as open (N4)", async () => {
    const a = await explorer("a");
    const empty = await f.publishedCollection(curA, orgA, 0);

    await save(a, empty.collectionId);

    // Only an empty collection is saved: no "all complete", no row.
    expect(await returnOf(a)).toEqual({ hasSaved: false, remaining: [], saveNudge: null });

    // With a complete collection next to it, "all complete" is true again; the empty one adds no row.
    const done = await f.publishedCollection(curA, orgA, 1);

    await save(a, done.collectionId);
    await pastVisit(a, done.placeIds[0]!);
    expect(await returnOf(a)).toEqual({ hasSaved: true, remaining: [], saveNudge: null });
  });

  it("lists at most three collections with something left", async () => {
    const a = await explorer("a");

    for (let i = 1; i <= 4; i += 1) {
      const made = await f.publishedCollection(curA, orgA, 2);

      await save(a, made.collectionId);
    }

    expect((await returnOf(a)).remaining).toHaveLength(3);
  });

  it("shows nothing of a withdrawn collection, also to the curator who owns it", async () => {
    const made = await f.publishedCollection(curA, orgA, 2);

    await pastVisit(curA, made.placeIds[0]!);
    expect((await returnOf(curA)).saveNudge).toEqual(
      expect.objectContaining({ id: made.collectionId }),
    );

    await f.setStatus(curA, made.collectionId, "draft");

    expect((await returnOf(curA)).saveNudge).toBeNull();
  });

  it("shows nothing of a collection of a suspended organization, and no new collection either", async () => {
    const a = await explorer("a");
    const nudged = await f.publishedCollection(curB, orgB, 2);
    const saved = await f.publishedCollection(curB, orgB, 2);

    await pastVisit(a, nudged.placeIds[0]!);
    await save(a, saved.collectionId);

    const before = await returnOf(a);

    expect(before.saveNudge).toEqual(expect.objectContaining({ id: nudged.collectionId }));
    expect(before.remaining).toHaveLength(1);
    expect((await getHomePublicReads(catalogDeps())).newCollections.map(({ id }) => id)).toEqual(
      expect.arrayContaining([nudged.collectionId, saved.collectionId]),
    );

    await f.suspendOrganization(orgB);

    try {
      expect(await returnOf(a)).toEqual({ hasSaved: false, remaining: [], saveNudge: null });
      const ids = (await getHomePublicReads(catalogDeps())).newCollections.map(({ id }) => id);

      expect(ids).not.toContain(nudged.collectionId);
      expect(ids).not.toContain(saved.collectionId);
    } finally {
      await f.approveOrganization(orgB);
    }
  });

  it("gives nothing for a collection the actor has not saved, even by a foreign id", async () => {
    const owner = await explorer("owner");
    const stranger = await explorer("stranger");
    const made = await f.publishedCollection(curA, orgA, 2);

    await save(owner, made.collectionId);

    const placesFor = (actor: TestUser) =>
      runInUserContext(app.em, { id: actor.id }, (tx) =>
        postgresAlbumRepository.homeUnvisitedPlaces(tx, [made.collectionId], 2),
      );

    // The owner gets the places; the same id asked by somebody who has not saved it gives none.
    expect(await placesFor(owner)).toHaveLength(2);
    expect(await placesFor(stranger)).toEqual([]);
  });

  it("lists new collections for a guest: published, of the last 30 days, without the excluded", async () => {
    const fresh = await f.publishedCollection(curA, orgA, 1);
    const excluded = await f.publishedCollection(curA, orgA, 1);
    const draft = await f.draftCollection(curA, orgA, 1);
    const old = await f.publishedCollection(curA, orgA, 1);

    // The trigger of publication is the only writer of first_published_at (it restores the old
    // value on every update), so it is switched off for the one backdating update.
    await admin$(`alter table public.collections disable trigger zz_collections_publication`);
    try {
      await admin$(
        `update public.collections set first_published_at = now() - interval '45 days' where id = $1`,
        [old.collectionId],
      );
    } finally {
      await admin$(`alter table public.collections enable trigger zz_collections_publication`);
    }

    const ids = (
      await getHomePublicReads(catalogDeps(), new Set([await slugOf(excluded.collectionId)]))
    ).newCollections.map(({ id }) => id);

    expect(ids).toContain(fresh.collectionId);
    expect(ids).not.toContain(excluded.collectionId);
    expect(ids).not.toContain(draft.collectionId);
    expect(ids).not.toContain(old.collectionId);
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(await asGuest(`select 1 from public.visits`)).toEqual([]);
  });

  it("draws the place of the day only among public places with a visible photo and a description", async () => {
    // A public place whose only photo is hidden does not qualify. The assertions do not assume
    // that no other test has described a place before (they only look at this test's places).
    const hiddenMade = await f.publishedCollection(curA, orgA, 1);
    const hiddenPhoto = await describePlace(orgA, hiddenMade.placeIds[0]!);

    await admin$(`update public.place_photos set hidden_at = now() where id = $1`, [hiddenPhoto]);
    resetPlaceOfDayCache();

    expect((await getHomePublicReads(catalogDeps())).placeOfDay?.id).not.toBe(
      hiddenMade.placeIds[0],
    );

    const made = await f.publishedCollection(curA, orgA, 1);
    const draft = await f.draftCollection(curA, orgA, 1);
    const placeId = made.placeIds[0]!;

    await retitle(made.collectionId, "Zamki nad rzeką");
    await describePlace(orgA, placeId);
    await describePlace(orgA, draft.placeIds[0]!);
    resetPlaceOfDayCache();

    const first = (await getHomePublicReads(catalogDeps())).placeOfDay;

    // The places of the draft collection and of the hidden photo never qualify; a qualifying
    // place exists (this test's public one), whichever other places other tests described.
    expect(first).not.toBeNull();
    expect(first?.id).not.toBe(draft.placeIds[0]);
    expect(first?.id).not.toBe(hiddenMade.placeIds[0]);
    resetPlaceOfDayCache();
    expect((await getHomePublicReads(catalogDeps())).placeOfDay).toEqual(first);
  });
});
