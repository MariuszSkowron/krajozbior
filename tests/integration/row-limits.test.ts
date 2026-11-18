import { randomInt } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AlbumDeps } from "@/features/album/application/album-types";
import {
  listMyCollectionsWithProgress,
  saveCollection,
} from "@/features/album/application/saved-collections";
import { postgresAlbumRepository } from "@/features/album/infrastructure/postgres-album-repository";
import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { addPlace } from "@/features/catalog/application/curator-places";
import { listCuratorCollections } from "@/features/catalog/application/curator-queries";
import {
  MAX_COLLECTIONS_PER_LIST,
  MAX_PLACES_PER_COLLECTION,
} from "@/features/catalog/domain/limits";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import type { WantToSeeDeps } from "@/features/want-to-see/application/want-to-see-types";
import { addToWantToSee, listWantToSee } from "@/features/want-to-see/application/want-to-see";
import { MAX_WANT_TO_SEE_LISTED } from "@/features/want-to-see/domain/limits";
import { postgresWantToSeeRepository } from "@/features/want-to-see/infrastructure/postgres-want-to-see-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// Upper bounds on rows (D-25) and the idempotent save of a collection or place
// that was withdrawn between the visibility check and the write. `app` is a
// pooled connection as krajozbior_app (max 1 connection). Bulk rows are made by
// the superuser connection; every use case under test runs as krajozbior_app.
let db: ScratchDatabase;
let app: MikroORM;

const explorerA = newUser("explorer-a");
const explorerB = newUser("explorer-b");
const curator = newUser("curator");

let org = "";

const f = albumFixtures({ db: () => db, app: () => app });
const { admin$, as } = f;

const limiter = { reserve: async () => ({ allowed: true as const }) };
const asActor = (user: { id: string }) => ({ id: user.id, role: "user" as const });
const withUserContext = <T>(
  actor: { id: string },
  work: Parameters<typeof runInUserContext<T>>[2],
) => runInUserContext(app.em, actor, work);

const catalogDeps = (): CatalogDeps => ({
  withUserContext,
  withGuestContext: (work) => runInGuestContext(app.em, work),
  limiter,
  repository: postgresCatalogRepository,
  random: (max) => randomInt(max),
});
const albumDeps = (): AlbumDeps => ({
  withUserContext,
  limiter,
  repository: postgresAlbumRepository,
});
const wantDeps = (): WantToSeeDeps => ({
  withUserContext,
  limiter,
  repository: postgresWantToSeeRepository,
});

let counter = 0;

// `count` collections of the organization in one statement, as superuser.
async function bulkCollections(
  organizationId: string,
  count: number,
  status: "draft" | "published",
): Promise<string[]> {
  const batch = (counter += 1);
  const rows = await admin$<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, region, status)
     select 'limit-${batch}-' || g, $1, 'Kolekcja ' || g, 'pomorskie', $2
       from generate_series(1, $3::int) g
     returning id`,
    [organizationId, status, count],
  );

  return rows.map((row) => row.id);
}

// `count` places of the organization linked to the collection, as superuser.
async function bulkPlaces(
  organizationId: string,
  collectionId: string,
  count: number,
): Promise<string[]> {
  const places = await admin$<{ id: string }>(
    `insert into public.places (organization_id, name, latitude, longitude)
     select $1, 'Miejsce ' || g, 54.0, 18.0 from generate_series(1, $2::int) g
     returning id`,
    [organizationId, count],
  );

  await admin$(
    `insert into public.collection_places (collection_id, place_id, organization_id, position)
     select $2, id, $1, (row_number() over (order by id))::int
       from public.places where id = any($3::uuid[])`,
    [organizationId, collectionId, places.map((place) => place.id)],
  );

  return places.map((place) => place.id);
}

describe("row limits and idempotent saves", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_row_limits");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, curator]);
    org = await f.newOrganization("Gmina Limitów", "gmina-limitow", [curator]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("keeps the limits at the values of D-25", () => {
    expect(MAX_COLLECTIONS_PER_LIST).toBe(200);
    expect(MAX_PLACES_PER_COLLECTION).toBe(500);
    expect(MAX_WANT_TO_SEE_LISTED).toBe(200);
  });

  it("lists at most 200 collections in the curator panel", async () => {
    await bulkCollections(org, MAX_COLLECTIONS_PER_LIST + 1, "draft");

    const listed = await listCuratorCollections(asActor(curator), org, catalogDeps());

    expect(listed.status).toBe("ok");
    expect(listed.status === "ok" ? listed.value.length : -1).toBe(MAX_COLLECTIONS_PER_LIST);
  });

  it("refuses the 501st place of one collection without creating anything", async () => {
    const [collectionId] = await bulkCollections(org, 1, "draft");

    await bulkPlaces(org, collectionId!, MAX_PLACES_PER_COLLECTION);

    const refused = await addPlace(
      asActor(curator),
      collectionId!,
      { name: "Pięćset pierwsze", latitude: 54.1, longitude: 18.7 },
      catalogDeps(),
    );

    expect(refused).toEqual({ status: "conflict", reason: "too_many_places" });
    expect(
      await admin$(`select 1 from public.collection_places where collection_id = $1`, [
        collectionId,
      ]),
    ).toHaveLength(MAX_PLACES_PER_COLLECTION);
    expect(
      await admin$(`select 1 from public.places where name = 'Pięćset pierwsze'`),
    ).toHaveLength(0);
  });

  it("lists at most 200 saved collections in the album and nothing of another explorer", async () => {
    const ids = await bulkCollections(org, MAX_COLLECTIONS_PER_LIST + 1, "published");

    await admin$(
      `insert into public.saved_collections (user_id, collection_id)
       select $1, id from public.collections where id = any($2::uuid[])`,
      [explorerA.id, ids],
    );

    const mine = await listMyCollectionsWithProgress(asActor(explorerA), albumDeps());
    const theirs = await listMyCollectionsWithProgress(asActor(explorerB), albumDeps());
    const guest = await listMyCollectionsWithProgress(null, albumDeps());

    expect(mine.status === "ok" ? mine.value.length : -1).toBe(MAX_COLLECTIONS_PER_LIST);
    expect(theirs).toEqual({ status: "ok", value: [] });
    expect(guest).toEqual({ status: "unauthenticated" });
  });

  it("lists at most 200 places on the want-to-see list and nothing of another explorer", async () => {
    const [collectionId] = await bulkCollections(org, 1, "published");
    const placeIds = await bulkPlaces(org, collectionId!, MAX_WANT_TO_SEE_LISTED + 1);

    await admin$(
      `insert into public.want_to_see_places (user_id, place_id)
       select $1, id from public.places where id = any($2::uuid[])`,
      [explorerA.id, placeIds],
    );

    const mine = await listWantToSee(asActor(explorerA), wantDeps());
    const theirs = await listWantToSee(asActor(explorerB), wantDeps());
    const guest = await listWantToSee(null, wantDeps());

    expect(mine.status === "ok" ? mine.value.length : -1).toBe(MAX_WANT_TO_SEE_LISTED);
    expect(theirs).toEqual({ status: "ok", value: [] });
    expect(guest).toEqual({ status: "unauthenticated" });
  });

  it("saves a collection twice with the same answer and one row", async () => {
    const { collectionId } = await f.publishedCollection(curator, org);

    const first = await saveCollection(asActor(explorerA), collectionId, albumDeps());
    const second = await saveCollection(asActor(explorerA), collectionId, albumDeps());

    expect(first).toEqual({ status: "ok", value: { saved: true } });
    expect(second).toEqual(first);
    expect(
      await admin$(`select 1 from public.saved_collections where collection_id = $1`, [
        collectionId,
      ]),
    ).toHaveLength(1);
  });

  it("answers not_found, not an error, when the collection is withdrawn after the check", async () => {
    const { collectionId } = await f.draftCollection(curator, org);
    // The check passed (the collection was public a moment ago); the write meets a draft.
    const afterCheck: AlbumDeps = {
      ...albumDeps(),
      repository: { ...postgresAlbumRepository, isPubliclyVisibleCollection: async () => true },
    };

    expect(await saveCollection(asActor(explorerA), collectionId, afterCheck)).toEqual({
      status: "not_found",
    });
    expect(
      await admin$(`select 1 from public.saved_collections where collection_id = $1`, [
        collectionId,
      ]),
    ).toHaveLength(0);
  });

  it("adds a place twice with the same answer and answers not_found when it is withdrawn after the check", async () => {
    const { placeIds } = await f.publishedCollection(curator, org);
    const { placeIds: draftPlaceIds } = await f.draftCollection(curator, org);
    const placeId = placeIds[0]!;
    const draftPlaceId = draftPlaceIds[0]!;

    const first = await addToWantToSee(asActor(explorerA), placeId, wantDeps());
    const second = await addToWantToSee(asActor(explorerA), placeId, wantDeps());

    expect(first).toEqual({ status: "ok", value: { wanted: true } });
    expect(second).toEqual(first);
    expect(
      await admin$(`select 1 from public.want_to_see_places where place_id = $1`, [placeId]),
    ).toHaveLength(1);

    const afterCheck: WantToSeeDeps = {
      ...wantDeps(),
      repository: { ...postgresWantToSeeRepository, isPubliclyVisiblePlace: async () => true },
    };

    expect(await addToWantToSee(asActor(explorerA), draftPlaceId, afterCheck)).toEqual({
      status: "not_found",
    });
    expect(
      await admin$(`select 1 from public.want_to_see_places where place_id = $1`, [draftPlaceId]),
    ).toHaveLength(0);
    // Another explorer never sees the first explorer's row.
    expect(
      await as(explorerB, `select place_id from public.want_to_see_places where place_id = ?`, [
        placeId,
      ]),
    ).toEqual([]);
  });
});
