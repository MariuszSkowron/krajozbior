import "server-only";

import type {
  AlbumRepository,
  CollectionPlaceLink,
  SavedCollectionRow,
} from "../application/album-types";

// Raw SQL on the transaction of the use case (user context). No statement takes
// a user id: the owner of a row is app_current_user_id(), and the row policies of
// saved_collections and visits (owner only) decide what is read or removed.
// "Published" is spelled out wherever a list is shown: the policies of a
// curator also show their own drafts, so a withdrawn collection of the member
// must not appear in the album (spec 7, withdrawal).

const publishedCollection = `c.status = 'published' and o.status = 'approved'`;

export const postgresAlbumRepository: AlbumRepository = {
  async listSavedCollections(tx) {
    return tx.em.execute<SavedCollectionRow[]>(
      `select c.id, c.slug, c.title, c.region
         from public.saved_collections sc
         join public.collections c on c.id = sc.collection_id
         join public.organizations o on o.id = c.organization_id
        where sc.user_id = app_current_user_id() and ${publishedCollection}
        order by sc.saved_at desc, c.id`,
    );
  },

  async listSavedCollectionPlaces(tx) {
    return tx.em.execute<CollectionPlaceLink[]>(
      `select cp.collection_id as "collectionId", cp.place_id as "placeId"
         from public.saved_collections sc
         join public.collections c on c.id = sc.collection_id
         join public.organizations o on o.id = c.organization_id
         join public.collection_places cp on cp.collection_id = c.id
        where sc.user_id = app_current_user_id() and ${publishedCollection}
        order by cp.collection_id, cp.position`,
    );
  },

  async listVisitedPlaceIds(tx) {
    const rows = await tx.em.execute<{ placeId: string }[]>(
      `select distinct v.place_id as "placeId"
         from public.visits v
         join public.collection_places cp on cp.place_id = v.place_id
         join public.saved_collections sc on sc.collection_id = cp.collection_id
        where v.user_id = app_current_user_id() and sc.user_id = app_current_user_id()`,
    );

    return rows.map((row) => row.placeId);
  },

  async isPubliclyVisibleCollection(tx, collectionId) {
    const rows = await tx.em.execute<{ ok: boolean }[]>(
      `select true as ok
         from public.collections c
         join public.organizations o on o.id = c.organization_id
        where c.id = ? and ${publishedCollection}`,
      [collectionId],
    );

    return rows.length > 0;
  },

  async saveCollection(tx, collectionId) {
    await tx.em.execute(
      `insert into public.saved_collections (user_id, collection_id)
       values (app_current_user_id(), ?)
       on conflict (user_id, collection_id) do nothing`,
      [collectionId],
    );
  },

  async unsaveCollection(tx, collectionId) {
    await tx.em.execute(
      `delete from public.saved_collections
        where user_id = app_current_user_id() and collection_id = ?`,
      [collectionId],
    );
  },

  async isCollectionSaved(tx, collectionId) {
    const rows = await tx.em.execute<{ ok: boolean }[]>(
      `select true as ok from public.saved_collections
        where user_id = app_current_user_id() and collection_id = ?`,
      [collectionId],
    );

    return rows.length > 0;
  },

  async listPlaceIdsOfCollection(tx, collectionId) {
    const rows = await tx.em.execute<{ placeId: string }[]>(
      `select cp.place_id as "placeId"
         from public.collection_places cp
         join public.collections c on c.id = cp.collection_id
         join public.organizations o on o.id = c.organization_id
        where cp.collection_id = ? and ${publishedCollection}
        order by cp.position`,
      [collectionId],
    );

    return rows.map((row) => row.placeId);
  },

  async listVisitedPlaceIdsOfCollection(tx, collectionId) {
    const rows = await tx.em.execute<{ placeId: string }[]>(
      `select distinct v.place_id as "placeId"
         from public.visits v
         join public.collection_places cp on cp.place_id = v.place_id
        where v.user_id = app_current_user_id() and cp.collection_id = ?`,
      [collectionId],
    );

    return rows.map((row) => row.placeId);
  },
};
