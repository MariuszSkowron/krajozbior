import "server-only";

import { MAX_COLLECTIONS_PER_LIST } from "@/features/catalog/domain/limits";

import { MAX_PROGRESS_PLACES } from "../domain/limits";
import type {
  AlbumRepository,
  CollectionPlaceLink,
  HomeFavoriteRow,
  SavedCollectionRow,
} from "../application/album-types";
import type { HomeRecentVisit } from "../domain/home-album";

// Raw SQL on the transaction of the use case (user context). No statement takes
// a user id: the owner of a row is app_current_user_id(), and the row policies of
// saved_collections and visits (owner only) decide what is read or removed.
// "Published" is spelled out wherever a list is shown: the policies of a
// curator also show their own drafts, so a withdrawn collection of the member
// must not appear in the album (spec 7, withdrawal).

const publishedCollection = `c.status = 'published' and o.status = 'approved'`;

// "The place lies in a public collection" (E12-1, D-E12-1a): spelled out wherever the home
// page shows data of a place, whatever the role of the actor. The place must also belong to
// an approved organization, as getPublishedPlace demands, so no link leads to a 404.
// RLS is the second barrier only: a curator's policies would show them more.
// The place is the row aliased `p`.
const placeInPublicCollection = `
  exists (
    select
      from public.collection_places pcp
      join public.collections c on c.id = pcp.collection_id
      join public.organizations o on o.id = c.organization_id
     where pcp.place_id = p.id and ${publishedCollection}
  ) and exists (
    select from public.organizations po
     where po.id = p.organization_id and po.status = 'approved'
  )`;

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

  async homeSummary(tx) {
    const rows = await tx.em.execute<
      { discoveredPlaces: number; regions: number; savedCollections: number }[]
    >(
      `select
         (select count(distinct v.place_id)::int
            from public.visits v
           where v.user_id = app_current_user_id()) as "discoveredPlaces",
         (select count(distinct c.region)::int
            from public.collections c
            join public.organizations o on o.id = c.organization_id
           where ${publishedCollection}
             and exists (
               select
                 from public.collection_places cp
                 join public.visits v on v.place_id = cp.place_id
                where cp.collection_id = c.id and v.user_id = app_current_user_id()
             )) as "regions",
         (select count(*)::int
            from public.saved_collections sc
            join public.collections c on c.id = sc.collection_id
            join public.organizations o on o.id = c.organization_id
           where sc.user_id = app_current_user_id() and ${publishedCollection}) as "savedCollections"`,
    );

    return rows[0] ?? { discoveredPlaces: 0, regions: 0, savedCollections: 0 };
  },

  async homeFavorites(tx, limit) {
    return tx.em.execute<HomeFavoriteRow[]>(
      `select c.id, c.slug, c.title, c.region,
              (select count(*)::int from public.collection_places cp
                where cp.collection_id = c.id) as total,
              (select count(*)::int from public.collection_places cp
                where cp.collection_id = c.id
                  and exists (select from public.visits v
                               where v.user_id = app_current_user_id()
                                 and v.place_id = cp.place_id)) as visited
         from public.saved_collections sc
         join public.collections c on c.id = sc.collection_id
         join public.organizations o on o.id = c.organization_id
        where sc.user_id = app_current_user_id() and ${publishedCollection}
        order by greatest(
                   sc.saved_at,
                   (select max(v.visited_at)
                      from public.visits v
                      join public.collection_places cp on cp.place_id = v.place_id
                     where v.user_id = app_current_user_id() and cp.collection_id = c.id)
                 ) desc, c.id
        limit ?`,
      [limit],
    );
  },

  async homeRecentVisits(tx, limit) {
    const rows = await tx.em.execute<
      {
        id: string;
        kind: HomeRecentVisit["kind"];
        visitedAt: Date | string;
        visitedOn: string | null;
        precision: HomeRecentVisit["precision"];
        placeId: string | null;
        placeName: string | null;
        placeAddress: string | null;
      }[]
    >(
      `select l.id, l.kind, l.visited_at as "visitedAt", l.visited_on::text as "visitedOn",
              l.date_precision as precision,
              p.id as "placeId", p.name as "placeName", p.address as "placeAddress"
         from (select id, place_id, kind, visited_at, visited_on, date_precision
                 from public.visits
                where user_id = app_current_user_id()
                order by visited_at desc, id desc
                limit ?) l
         left join public.places p
                on p.id = l.place_id and ${placeInPublicCollection}
        order by l.visited_at desc, l.id desc`,
      [limit],
    );

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      visitedAt: new Date(row.visitedAt),
      visitedOn: row.visitedOn,
      precision: row.precision,
      place:
        row.placeId === null
          ? null
          : { id: row.placeId, name: row.placeName ?? "", address: row.placeAddress ?? "" },
    }));
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
