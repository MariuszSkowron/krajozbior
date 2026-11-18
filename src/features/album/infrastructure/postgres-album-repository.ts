import "server-only";

import { MAX_COLLECTIONS_PER_LIST } from "@/features/catalog/domain/limits";

import { MAX_PROGRESS_PLACES } from "../domain/limits";
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

// The collections of the list "Moje kolekcje" (one `?`: MAX_COLLECTIONS_PER_LIST).
// Places and visits of the album are read only for these, so the progress never
// counts a collection the list does not show.
const listedCollectionIds = `
  select sc.collection_id
    from public.saved_collections sc
    join public.collections c on c.id = sc.collection_id
    join public.organizations o on o.id = c.organization_id
   where sc.user_id = app_current_user_id() and ${publishedCollection}
   order by sc.saved_at desc, sc.collection_id
   limit ?`;

export const postgresAlbumRepository: AlbumRepository = {
  async listSavedCollections(tx) {
    return tx.em.execute<SavedCollectionRow[]>(
      `select c.id, c.slug, c.title, c.region
         from public.saved_collections sc
         join public.collections c on c.id = sc.collection_id
         join public.organizations o on o.id = c.organization_id
        where sc.user_id = app_current_user_id() and ${publishedCollection}
        order by sc.saved_at desc, c.id
        limit ?`,
      [MAX_COLLECTIONS_PER_LIST],
    );
  },

  async listSavedCollectionPlaces(tx) {
    return tx.em.execute<CollectionPlaceLink[]>(
      `select cp.collection_id as "collectionId", cp.place_id as "placeId"
         from public.collection_places cp
        where cp.collection_id in (${listedCollectionIds})
        order by cp.collection_id, cp.position`,
      [MAX_COLLECTIONS_PER_LIST],
    );
  },

  async listVisitedPlaceIds(tx) {
    const rows = await tx.em.execute<{ placeId: string }[]>(
      `select distinct v.place_id as "placeId"
         from public.visits v
         join public.collection_places cp on cp.place_id = v.place_id
        where v.user_id = app_current_user_id()
          and cp.collection_id in (${listedCollectionIds})
        order by v.place_id
        limit ?`,
      [MAX_COLLECTIONS_PER_LIST, MAX_PROGRESS_PLACES],
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
    // The lock is a statement of its own: the statement below then takes its
    // snapshot after the lock is held, so it counts every save that finished and
    // two simultaneous saves of one actor cannot both take the last place.
    await tx.em.execute(
      `select pg_advisory_xact_lock(
         hashtextextended('saved_collections:' || app_current_user_id()::text, 0))`,
    );

    // One statement: the visibility test, the count and the insert see the same
    // snapshot, so a collection withdrawn in between is answered with
    // `not_found`, not with a refusal of the row policy. A repeated save
    // conflicts and changes nothing, also when the actor is at the limit. The
    // count is of the collections the list shows (published ones).
    const rows = await tx.em.execute<{ visible: number; allowed: boolean }[]>(
      `with target as (
         select c.id
           from public.collections c
           join public.organizations o on o.id = c.organization_id
          where c.id = ? and ${publishedCollection}
       ), held as (
         select count(*)::int as total
           from public.saved_collections sc
           join public.collections c on c.id = sc.collection_id
           join public.organizations o on o.id = c.organization_id
          where sc.user_id = app_current_user_id() and ${publishedCollection}
       ), allowed as (
         select exists (
                  select from public.saved_collections
                   where user_id = app_current_user_id() and collection_id = ?
                ) or (select total from held) < ? as ok
       ), saved as (
         insert into public.saved_collections (user_id, collection_id)
         select app_current_user_id(), id from target
          where (select ok from allowed)
         on conflict (user_id, collection_id) do nothing
       )
       select (select count(*) from target)::int as visible,
              (select ok from allowed) as allowed`,
      [collectionId, collectionId, MAX_COLLECTIONS_PER_LIST],
    );

    if ((rows[0]?.visible ?? 0) === 0) {
      return "not_found";
    }

    return rows[0]?.allowed === true ? "saved" : "too_many";
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
