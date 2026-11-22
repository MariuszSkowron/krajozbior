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
import { createCollection } from "@/features/catalog/application/curator-collections";
import { addPlace } from "@/features/catalog/application/curator-places";
import { listCuratorCollections } from "@/features/catalog/application/curator-queries";
import {
  MAX_COLLECTIONS_PER_LIST,
  MAX_PLACES_PER_COLLECTION,
} from "@/features/catalog/domain/limits";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import {
  addPlaceToOwnCollection,
  createOwnCollection,
} from "@/features/own-collections/application/own-collections";
import type { OwnCollectionsDeps } from "@/features/own-collections/application/own-collection-types";
import {
  MAX_ITEMS_PER_OWN_COLLECTION,
  MAX_OWN_COLLECTIONS,
} from "@/features/own-collections/domain/limits";
import { postgresOwnCollectionsRepository } from "@/features/own-collections/infrastructure/postgres-own-collections-repository";
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
const explorerC = newUser("explorer-c");
const explorerD = newUser("explorer-d");
const explorerE = newUser("explorer-e");
const explorerF = newUser("explorer-f");
const explorerG = newUser("explorer-g");
const explorerH = newUser("explorer-h");
const curatorB = newUser("curator-b");
const curatorC = newUser("curator-c");

let org = "";
// Second pool with two connections: the races below need two real transactions.
let appWide: MikroORM;

const f = albumFixtures({ db: () => db, app: () => app });
const { admin$, as } = f;

const limiter = { reserve: async () => ({ allowed: true as const }) };
const asActor = (user: { id: string }) => ({ id: user.id, role: "user" as const });
const withUserContext = <T>(
  actor: { id: string },
  work: Parameters<typeof runInUserContext<T>>[2],
) => runInUserContext(app.em, actor, work);

const wideUserContext = <T>(
  actor: { id: string },
  work: Parameters<typeof runInUserContext<T>>[2],
) => runInUserContext(appWide.em, actor, work);

const catalogDeps = (): CatalogDeps => ({
  withUserContext,
  withGuestContext: (work) => runInGuestContext(app.em, work),
  limiter,
  repository: postgresCatalogRepository,
  random: (max) => randomInt(max),
});
const ownInput = { title: "Własna", summary: "", region: "polska" };
const ownDeps = (): OwnCollectionsDeps => ({
  withUserContext,
  limiter,
  repository: postgresOwnCollectionsRepository,
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
    await f.insertUsers([
      explorerA,
      explorerB,
      explorerC,
      explorerD,
      explorerE,
      explorerF,
      explorerG,
      explorerH,
      curator,
      curatorB,
      curatorC,
    ]);
    org = await f.newOrganization("Gmina Limitów", "gmina-limitow", [curator]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
    appWide = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 2, max: 2 },
    });
  }, 60_000);

  afterAll(async () => {
    await appWide?.close(true);
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

    const first = await saveCollection(asActor(explorerD), collectionId, albumDeps());
    const second = await saveCollection(asActor(explorerD), collectionId, albumDeps());

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

    const first = await addToWantToSee(asActor(explorerD), placeId, wantDeps());
    const second = await addToWantToSee(asActor(explorerD), placeId, wantDeps());

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

  // D-28: the limit is also kept when writing, so nothing disappears from a list silently.
  const newCollectionInput = (organizationId: string, title: string) => ({
    organizationId,
    title,
    region: "pomorskie",
  });

  it("refuses the 201st collection of an organization and leaves other organizations alone", async () => {
    const full = await f.newOrganization("Gmina Pełna", "gmina-pelna", [curatorB]);
    const other = await f.newOrganization("Gmina Wolna", "gmina-wolna", [curatorC]);

    await bulkCollections(full, MAX_COLLECTIONS_PER_LIST, "draft");

    const refused = await createCollection(
      asActor(curatorB),
      newCollectionInput(full, "Dwieście pierwsza"),
      catalogDeps(),
    );

    expect(refused).toEqual({ status: "conflict", reason: "too_many_collections" });
    expect(
      await admin$(`select 1 from public.collections where organization_id = $1`, [full]),
    ).toHaveLength(MAX_COLLECTIONS_PER_LIST);
    // Another organization is not affected; a curator of it cannot write into the full one.
    const created = await createCollection(
      asActor(curatorC),
      newCollectionInput(other, "Pierwsza"),
      catalogDeps(),
    );

    expect(created.status).toBe("ok");
    expect(
      await createCollection(asActor(curatorC), newCollectionInput(full, "Obca"), catalogDeps()),
    ).toEqual({ status: "forbidden" });
    expect(await createCollection(null, newCollectionInput(full, "Gość"), catalogDeps())).toEqual({
      status: "unauthenticated",
    });
  });

  it("lets only one of two simultaneous creations take the last place of an organization", async () => {
    const racing = await f.newOrganization("Gmina Wyścigu", "gmina-wyscigu", [curatorB, curatorC]);
    const wide: CatalogDeps = { ...catalogDeps(), withUserContext: wideUserContext };

    await bulkCollections(racing, MAX_COLLECTIONS_PER_LIST - 1, "draft");

    const results = await Promise.all(
      [curatorB, curatorC].map((who) =>
        createCollection(asActor(who), newCollectionInput(racing, "Wyścig"), wide),
      ),
    );

    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "ok"]);
    expect(
      await admin$(`select 1 from public.collections where organization_id = $1`, [racing]),
    ).toHaveLength(MAX_COLLECTIONS_PER_LIST);
  });

  it("refuses the 201st saved collection, keeps a repeated save idempotent and spares others", async () => {
    const ids = await bulkCollections(org, MAX_COLLECTIONS_PER_LIST, "published");
    const [extra] = await bulkCollections(org, 1, "published");

    await admin$(
      `insert into public.saved_collections (user_id, collection_id)
       select $1, unnest($2::uuid[])`,
      [explorerC.id, ids],
    );

    expect(await saveCollection(asActor(explorerC), extra!, albumDeps())).toEqual({
      status: "conflict",
      reason: "too_many_saved",
    });
    expect(
      await admin$(`select 1 from public.saved_collections where user_id = $1`, [explorerC.id]),
    ).toHaveLength(MAX_COLLECTIONS_PER_LIST);
    // A collection that is already saved stays saved, answer unchanged.
    expect(await saveCollection(asActor(explorerC), ids[0]!, albumDeps())).toEqual({
      status: "ok",
      value: { saved: true },
    });
    // Another explorer and a guest.
    expect(await saveCollection(asActor(explorerD), extra!, albumDeps())).toEqual({
      status: "ok",
      value: { saved: true },
    });
    expect(await saveCollection(null, extra!, albumDeps())).toEqual({ status: "unauthenticated" });
  });

  it("counts own collections with the saved ones: the 200th saved collection is refused beside one own (E8-1a, [P-E8-A3])", async () => {
    const explorer = newUser("explorer-own-limit");

    await f.insertUsers([explorer]);

    const ids = await bulkCollections(org, MAX_COLLECTIONS_PER_LIST, "published");

    expect((await createOwnCollection(asActor(explorer), ownInput, ownDeps())).status).toBe("ok");
    await admin$(
      `insert into public.saved_collections (user_id, collection_id)
       select $1, unnest($2::uuid[])`,
      [explorer.id, ids.slice(0, MAX_COLLECTIONS_PER_LIST - 1)],
    );

    // 1 own + 199 saved = 200 on the list: the 200th saved one does not fit.
    expect(await saveCollection(asActor(explorer), ids.at(-1)!, albumDeps())).toEqual({
      status: "conflict",
      reason: "too_many_saved",
    });
    // And neither does another own collection.
    expect(await createOwnCollection(asActor(explorer), ownInput, ownDeps())).toEqual({
      status: "conflict",
      reason: "my_collections_full",
    });
    // A collection that is already saved stays saved.
    expect(await saveCollection(asActor(explorer), ids[0]!, albumDeps())).toEqual({
      status: "ok",
      value: { saved: true },
    });
  });

  it("refuses the 51st own collection and keeps the limit under simultaneous writes", async () => {
    const explorer = newUser("explorer-own-50");

    await f.insertUsers([explorer]);
    await admin$(
      `insert into public.user_collections (owner_user_id, title, region)
       select $1, 'Własna ' || g, 'polska' from generate_series(1, $2::int) g`,
      [explorer.id, MAX_OWN_COLLECTIONS - 1],
    );

    const wide: OwnCollectionsDeps = { ...ownDeps(), withUserContext: wideUserContext };
    const results = await Promise.all([
      createOwnCollection(asActor(explorer), ownInput, wide),
      createOwnCollection(asActor(explorer), ownInput, wide),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "ok"]);
    expect(results.find((result) => result.status === "conflict")).toEqual({
      status: "conflict",
      reason: "too_many_own_collections",
    });
    expect(
      await admin$(`select 1 from public.user_collections where owner_user_id = $1`, [explorer.id]),
    ).toHaveLength(MAX_OWN_COLLECTIONS);
  });

  it("refuses the 201st place of an own collection and keeps the limit under simultaneous adds", async () => {
    const explorer = newUser("explorer-own-items");

    await f.insertUsers([explorer]);

    const [catalogCollection] = await bulkCollections(org, 1, "published");
    const placeIds = await bulkPlaces(org, catalogCollection!, MAX_ITEMS_PER_OWN_COLLECTION + 2);
    const created = await createOwnCollection(asActor(explorer), ownInput, ownDeps());
    const collectionId = created.status === "ok" ? created.value.id : "";

    // The entries are bulk rows made by the superuser (the trigger gives them their names).
    await admin$(
      `insert into public.user_collection_items (user_collection_id, position, place_id)
       select $1, row_number() over (order by p), p from unnest($2::uuid[]) p`,
      [collectionId, placeIds.slice(0, MAX_ITEMS_PER_OWN_COLLECTION - 1)],
    );

    const wide: OwnCollectionsDeps = { ...ownDeps(), withUserContext: wideUserContext };
    const results = await Promise.all(
      placeIds
        .slice(MAX_ITEMS_PER_OWN_COLLECTION - 1, MAX_ITEMS_PER_OWN_COLLECTION + 1)
        .map((placeId) =>
          addPlaceToOwnCollection(asActor(explorer), collectionId, { placeId }, wide),
        ),
    );

    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "ok"]);
    expect(
      await admin$(`select 1 from public.user_collection_items where user_collection_id = $1`, [
        collectionId,
      ]),
    ).toHaveLength(MAX_ITEMS_PER_OWN_COLLECTION);
    // A repeated add of a place that is there stays idempotent even at the limit.
    expect(
      await addPlaceToOwnCollection(
        asActor(explorer),
        collectionId,
        { placeId: placeIds[0] },
        ownDeps(),
      ),
    ).toEqual({ status: "ok", value: { added: false } });
  });

  it("lets only one of two simultaneous saves take the last place of an explorer", async () => {
    const ids = await bulkCollections(org, MAX_COLLECTIONS_PER_LIST + 1, "published");
    const wide: AlbumDeps = { ...albumDeps(), withUserContext: wideUserContext };

    await admin$(
      `insert into public.saved_collections (user_id, collection_id)
       select $1, unnest($2::uuid[])`,
      [explorerE.id, ids.slice(0, MAX_COLLECTIONS_PER_LIST - 1)],
    );

    const results = await Promise.all(
      ids
        .slice(MAX_COLLECTIONS_PER_LIST - 1)
        .map((id) => saveCollection(asActor(explorerE), id, wide)),
    );

    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "ok"]);
    expect(
      await admin$(`select 1 from public.saved_collections where user_id = $1`, [explorerE.id]),
    ).toHaveLength(MAX_COLLECTIONS_PER_LIST);
  });

  it("refuses the 201st place on the want-to-see list and keeps a repeated add idempotent", async () => {
    const [collectionId] = await bulkCollections(org, 1, "published");
    const placeIds = await bulkPlaces(org, collectionId!, MAX_WANT_TO_SEE_LISTED + 1);
    const last = placeIds[MAX_WANT_TO_SEE_LISTED]!;

    await admin$(
      `insert into public.want_to_see_places (user_id, place_id)
       select $1, unnest($2::uuid[])`,
      [explorerF.id, placeIds.slice(0, MAX_WANT_TO_SEE_LISTED)],
    );

    expect(await addToWantToSee(asActor(explorerF), last, wantDeps())).toEqual({
      status: "conflict",
      reason: "too_many_wanted",
    });
    expect(
      await admin$(`select 1 from public.want_to_see_places where user_id = $1`, [explorerF.id]),
    ).toHaveLength(MAX_WANT_TO_SEE_LISTED);
    expect(await addToWantToSee(asActor(explorerF), placeIds[0]!, wantDeps())).toEqual({
      status: "ok",
      value: { wanted: true },
    });
    expect(await addToWantToSee(asActor(explorerD), last, wantDeps())).toEqual({
      status: "ok",
      value: { wanted: true },
    });
    expect(await addToWantToSee(null, last, wantDeps())).toEqual({ status: "unauthenticated" });
  });

  it("lets only one of two simultaneous adds take the last place of the list", async () => {
    const [collectionId] = await bulkCollections(org, 1, "published");
    const placeIds = await bulkPlaces(org, collectionId!, MAX_WANT_TO_SEE_LISTED + 1);
    const wide: WantToSeeDeps = { ...wantDeps(), withUserContext: wideUserContext };

    await admin$(
      `insert into public.want_to_see_places (user_id, place_id)
       select $1, unnest($2::uuid[])`,
      [explorerG.id, placeIds.slice(0, MAX_WANT_TO_SEE_LISTED - 1)],
    );

    const results = await Promise.all(
      placeIds
        .slice(MAX_WANT_TO_SEE_LISTED - 1)
        .map((id) => addToWantToSee(asActor(explorerG), id, wide)),
    );

    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "ok"]);
    expect(
      await admin$(`select 1 from public.want_to_see_places where user_id = $1`, [explorerG.id]),
    ).toHaveLength(MAX_WANT_TO_SEE_LISTED);
  });

  it("lists at most 500 places outside a collection, and none of another organization", async () => {
    const places = await f.newOrganization("Gmina Miejsc", "gmina-miejsc", [curatorC]);
    const [collectionId] = await bulkCollections(places, 1, "draft");

    await admin$(
      `insert into public.places (organization_id, name, latitude, longitude)
       select $1, 'Wolne ' || g, 54.0, 18.0 from generate_series(1, $2::int) g`,
      [places, MAX_PLACES_PER_COLLECTION + 1],
    );

    const list = (who: { id: string }) =>
      runInUserContext(app.em, who, (tx) =>
        postgresCatalogRepository.listPlacesOutsideCollection(tx, places, collectionId!),
      );

    expect(await list(curatorC)).toHaveLength(MAX_PLACES_PER_COLLECTION);
    expect(await list(curatorB)).toEqual([]);
  });

  it("keeps the places and visits of the album to the same 200 collections as the list", async () => {
    const collectionIds = await bulkCollections(org, MAX_COLLECTIONS_PER_LIST + 1, "published");
    const places = await admin$<{ id: string }>(
      `insert into public.places (organization_id, name, latitude, longitude)
       select $1, 'Album ' || g, 54.0, 18.0 from generate_series(1, $2::int) g
       returning id`,
      [org, collectionIds.length],
    );
    const placeIds = places.map((place) => place.id);

    await admin$(
      `insert into public.collection_places (collection_id, place_id, organization_id, position)
       select c, p, $1, 1 from unnest($2::uuid[], $3::uuid[]) as t(c, p)`,
      [org, collectionIds, placeIds],
    );
    // The first collection was saved last (newest), the 201st first (oldest, left out).
    await admin$(
      `insert into public.saved_collections (user_id, collection_id, saved_at)
       select $1, c, now() - ord * interval '1 second'
         from unnest($2::uuid[]) with ordinality as t(c, ord)`,
      [explorerH.id, collectionIds],
    );
    await admin$(
      `insert into public.visits (user_id, place_id, kind, date_precision)
       select $1, unnest($2::uuid[]), 'past', 'unknown'`,
      [explorerH.id, placeIds],
    );

    const read = await runInUserContext(app.em, explorerH, async (tx) => ({
      collections: await postgresAlbumRepository.listSavedCollections(tx),
      links: await postgresAlbumRepository.listSavedCollectionPlaces(tx),
      visited: await postgresAlbumRepository.listVisitedPlaceIds(tx),
    }));
    const listed = new Set(read.collections.map((collection) => collection.id));

    expect(listed.size).toBe(MAX_COLLECTIONS_PER_LIST);
    expect(read.links).toHaveLength(MAX_COLLECTIONS_PER_LIST);
    expect(read.links.every((link) => listed.has(link.collectionId))).toBe(true);
    expect(read.visited).toHaveLength(MAX_COLLECTIONS_PER_LIST);
    expect(read.visited).not.toContain(placeIds[MAX_COLLECTIONS_PER_LIST]);
  });
});
