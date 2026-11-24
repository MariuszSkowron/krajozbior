import "server-only";

import { MAX_COLLECTIONS_PER_LIST } from "@/features/catalog/domain/limits";
import {
  placeInPublicCollection,
  publishedCollection,
} from "@/features/catalog/infrastructure/public-visibility";

import { MAX_PROGRESS_PLACES } from "../domain/limits";
import type {
  AlbumRepository,
  CollectionPlaceLink,
  HomeFavoriteRow,
  IncompleteSavedRow,
  SavedCollectionRow,
} from "../application/album-types";
import type { HomeRecentVisit } from "../domain/home-album";
import type { StartedUnsavedCollection, UnvisitedPlace } from "../domain/home-return";

// Raw SQL on the transaction of the use case (user context). No statement takes
// a user id: the owner of a row is app_current_user_id(), and the row policies of
// saved_collections and visits (owner only) decide what is read or removed.
// "Published" is spelled out wherever a list is shown: the policies of a
// curator also show their own drafts, so a withdrawn collection of the member
// must not appear in the album (spec 7, withdrawal).

// (`publishedCollection` and `placeInPublicCollection` live in the catalog: public-visibility.ts.)

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
         -- "Moje kolekcje" shows the own collections (E8-1a) and the saved ones together, so the
         -- limit of 200 counts both ([P-E8-A3]); the own ones are created under the same lock.
         select (select count(*)::int
                   from public.saved_collections sc
                   join public.collections c on c.id = sc.collection_id
                   join public.organizations o on o.id = c.organization_id
                  where sc.user_id = app_current_user_id() and ${publishedCollection})
                + (select count(*)::int
                     from public.user_collections uc
                    where uc.owner_user_id = app_current_user_id()) as total
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
            from public.visits v
            join public.collection_places cp on cp.place_id = v.place_id
            join public.collections c on c.id = cp.collection_id
            join public.organizations o on o.id = c.organization_id
           where v.user_id = app_current_user_id() and ${publishedCollection}) as "regions",
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

  async homeUnvisitedPlaces(tx, collectionIds, perCollection) {
    if (collectionIds.length === 0) {
      return [];
    }

    // The ids come from the use case, but the statement checks again that each collection is saved
    // by the actor and public, so a foreign id gives nothing.
    return tx.em.execute<UnvisitedPlace[]>(
      `select x.collection_id as "collectionId", x.name, x.position
         from (select cp.collection_id, p.name, cp.position,
                      row_number() over (partition by cp.collection_id order by cp.position) as rn
                 from public.saved_collections sc
                 join public.collections c on c.id = sc.collection_id
                 join public.organizations o on o.id = c.organization_id
                 join public.collection_places cp on cp.collection_id = c.id
                 join public.places p on p.id = cp.place_id
                where sc.user_id = app_current_user_id() and ${publishedCollection}
                  and c.id in (${collectionIds.map(() => "?").join(", ")})
                  and not exists (select from public.visits v
                                   where v.user_id = app_current_user_id()
                                     and v.place_id = p.id)) x
        where x.rn <= ?
        order by x.collection_id, x.position`,
      [...collectionIds, perCollection],
    );
  },

  async homeIncompleteSaved(tx, limit) {
    // All saved public collections are counted (not only the latest six of `homeFavorites`), and
    // the filter and the limit are in the statement, in the same order as `homeFavorites`.
    return tx.em.execute<IncompleteSavedRow[]>(
      `select s.id, s.slug, s.title, s.total, s.visited
         from (select c.id, c.slug, c.title,
                      (select count(*)::int from public.collection_places cp
                        where cp.collection_id = c.id) as total,
                      (select count(*)::int from public.collection_places cp
                        where cp.collection_id = c.id
                          and exists (select from public.visits v
                                       where v.user_id = app_current_user_id()
                                         and v.place_id = cp.place_id)) as visited,
                      greatest(
                        sc.saved_at,
                        (select max(v.visited_at)
                           from public.visits v
                           join public.collection_places cp on cp.place_id = v.place_id
                          where v.user_id = app_current_user_id() and cp.collection_id = c.id)
                      ) as last_used
                 from public.saved_collections sc
                 join public.collections c on c.id = sc.collection_id
                 join public.organizations o on o.id = c.organization_id
                where sc.user_id = app_current_user_id() and ${publishedCollection}) s
        where s.visited < s.total
        order by s.last_used desc, s.id
        limit ?`,
      [limit],
    );
  },

  async homeStartedUnsaved(tx, limit) {
    // Starts from the visits of the actor (not from the whole catalogue): the collections that
    // hold a visited place, then only those that are public and not saved get a total.
    return tx.em.execute<StartedUnsavedCollection[]>(
      `select c.id, c.slug, c.title,
              (select count(*)::int from public.collection_places cp
                where cp.collection_id = c.id) as total,
              s.visited
         from (select cp.collection_id, count(distinct cp.place_id)::int as visited,
                      max(v.visited_at) as last_visit
                 from public.visits v
                 join public.collection_places cp on cp.place_id = v.place_id
                where v.user_id = app_current_user_id()
                group by cp.collection_id) s
         join public.collections c on c.id = s.collection_id
         join public.organizations o on o.id = c.organization_id
        where ${publishedCollection}
          and not exists (select from public.saved_collections sc
                           where sc.user_id = app_current_user_id()
                             and sc.collection_id = c.id)
        order by s.visited desc, s.last_visit desc, c.id
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
