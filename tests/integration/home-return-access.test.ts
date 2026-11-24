import { randomInt, randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AlbumDeps } from "@/features/album/application/album-types";
import { getHomeReturn } from "@/features/album/application/home-album";
import { postgresAlbumRepository } from "@/features/album/infrastructure/postgres-album-repository";
import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import {
  getPlaceOfTheDay,
  listNewCollections,
} from "@/features/catalog/application/public-catalog";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// Powody do powrotu na Starcie (D-58 pkt 4): "Do odkrycia w Twoich kolekcjach" i zachęta do zapisu
// (dane własne odkrywcy, RLS) oraz "Nowe kolekcje" i "Miejsce dnia" (dane publiczne, kontekst
// gościa), jako krajozbior_app na puli jednego połączenia. Odmowa: gość nie dostaje nic, odkrywca B
// nie widzi wizyt A, a wycofana kolekcja i kolekcja zawieszonej organizacji nie pojawiają się nigdzie.
let db: ScratchDatabase;
let app: MikroORM;

const explorerA = newUser("explorer-a");
const explorerB = newUser("explorer-b");
const curA = newUser("cur-a");

let orgA = "";

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

async function returnOf(actor: { id: string }) {
  const result = await getHomeReturn({ id: actor.id, role: "user" }, albumDeps());

  if (result.status !== "ok") {
    throw new Error(`home return answered ${result.status}`);
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

describe("home page: reasons to return", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_home_return");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, curA]);
    orgA = await f.newOrganization("Gmina A", "gmina-a", [curA]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("gives nothing to a guest: no actor is refused before any read", async () => {
    expect(await getHomeReturn(null, albumDeps())).toEqual({ status: "unauthenticated" });
  });

  it("is empty for an explorer without visits or saves", async () => {
    expect(await returnOf(explorerB)).toEqual({ hasSaved: false, remaining: [], saveNudge: null });
  });

  it("nudges to save a started collection, then lists what is left once it is saved", async () => {
    const { collectionId, placeIds } = await f.publishedCollection(curA, orgA, 3);

    await pastVisit(explorerA, placeIds[0]!);

    expect(await returnOf(explorerA)).toEqual({
      hasSaved: false,
      remaining: [],
      saveNudge: expect.objectContaining({ id: collectionId, visited: 1, total: 3 }),
    });

    await save(explorerA, collectionId);

    const after = await returnOf(explorerA);

    expect(after.saveNudge).toBeNull();
    expect(after.hasSaved).toBe(true);
    expect(after.remaining).toEqual([
      expect.objectContaining({ title: "Kolekcja", remaining: 2, names: ["Miejsce", "Miejsce"] }),
    ]);
  });

  it("keeps explorer B out of the visits of explorer A, also for the same collection", async () => {
    const { collectionId, placeIds } = await f.publishedCollection(curA, orgA, 2);

    await pastVisit(explorerA, placeIds[0]!);
    await pastVisit(explorerA, placeIds[1]!);
    await save(explorerB, collectionId);

    // B has no visit of their own: all places are left, and the nudge is about no collection of A.
    const b = await returnOf(explorerB);

    expect(b.saveNudge).toBeNull();
    expect(b.remaining).toEqual([expect.objectContaining({ remaining: 2 })]);
    // The same collection saved by A is complete for A: nothing left, and nothing nudged.
    await save(explorerA, collectionId);
    expect((await returnOf(explorerA)).remaining).toEqual([
      expect.objectContaining({ remaining: 2 }),
    ]);
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

  it("lists only published collections of the last 30 days as new, to a guest", async () => {
    const fresh = await f.publishedCollection(curA, orgA, 1);
    const draft = await f.draftCollection(curA, orgA, 1);
    const old = await f.publishedCollection(curA, orgA, 1);

    await admin$(
      `update public.collections set first_published_at = now() - interval '45 days' where id = $1`,
      [old.collectionId],
    );

    const ids = (await listNewCollections(catalogDeps())).map(({ id }) => id);

    expect(ids).toContain(fresh.collectionId);
    expect(ids).not.toContain(draft.collectionId);
    expect(ids).not.toContain(old.collectionId);
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(await asGuest(`select 1 from public.visits`)).toEqual([]);
  });

  it("draws the place of the day only among public places with a photo and a description", async () => {
    expect(await getPlaceOfTheDay(catalogDeps())).toBeNull();

    const made = await f.publishedCollection(curA, orgA, 1);
    const placeId = made.placeIds[0]!;
    const draft = await f.draftCollection(curA, orgA, 1);

    await admin$(
      `update public.places set description = 'Zamek nad rzeką. Drugie zdanie.' where id = any($1)`,
      [[placeId, draft.placeIds[0]]],
    );

    for (const id of [placeId, draft.placeIds[0]!]) {
      await admin$(
        `insert into public.place_photos
           (organization_id, place_id, position, file_state, storage_key, width, height, alt_text,
            source_kind, title, author_text, source_url, license_code, license_url, license_label,
            rights_statement, commons_file)
         values ($1, $2, 1, 'ready', $3, 1600, 1067, 'Zamek', 'commons_import', 'Zamek',
                 'Autor', 'https://commons.wikimedia.org/wiki/File:Zamek.jpg', 'cc-by-sa-3.0',
                 'https://creativecommons.org/licenses/by-sa/3.0/pl/', 'CC BY-SA 3.0 PL',
                 'commons-import/1', $4)`,
        [orgA, id, randomUUID(), `Zamek-${id}.jpg`],
      );
    }

    const first = await getPlaceOfTheDay(catalogDeps());

    // The place of the draft collection never qualifies; the only candidate is the public one.
    expect(first).toEqual(
      expect.objectContaining({
        id: placeId,
        collection: expect.objectContaining({ title: "Kolekcja" }),
      }),
    );
    expect(await getPlaceOfTheDay(catalogDeps())).toEqual(first);
  });
});
