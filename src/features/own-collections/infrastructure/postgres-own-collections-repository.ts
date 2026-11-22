import "server-only";

import {
  placeInPublicCollection,
  publishedCollection,
} from "@/features/catalog/infrastructure/public-visibility";

import {
  MAX_ITEMS_PER_OWN_COLLECTION,
  MAX_MY_COLLECTIONS,
  MAX_OWN_COLLECTIONS,
} from "../domain/limits";
import type {
  AddEntryResult,
  CreateOwnCollectionResult,
  OwnCollectionRow,
  OwnCollectionSummary,
  OwnCollectionsRepository,
  OwnEntryRow,
  UpdateOwnCollectionResult,
} from "../application/own-collection-types";

// Raw SQL on the transaction of the use case (user context). No statement takes a user id: the
// owner of a row is app_current_user_id(), and the row policies of user_collections and
// user_collection_items (owner only) decide what is read, changed or removed. "Public" is spelled
// out wherever a place is shown or added (`placeInPublicCollection`): the policies of a curator
// also show their own drafts, so the policy alone would not tell a draft from a public place.

// The lock of the actor is the key of saving a collection of a curator (postgres-album-repository):
// the limit of 200 covers own and saved collections together, so both paths take one lock.
const myCollectionsLock = `
  select pg_advisory_xact_lock(
    hashtextextended('saved_collections:' || app_current_user_id()::text, 0))`;

export const postgresOwnCollectionsRepository: OwnCollectionsRepository = {
  async listOwn(tx) {
    return tx.em.execute<OwnCollectionSummary[]>(
      `select c.id, c.title, c.summary, c.region, c.version,
              (select count(*)::int
                 from public.user_collection_items i
                 join public.places p on p.id = i.place_id
                where i.user_collection_id = c.id and ${placeInPublicCollection}) as total,
              (select count(*)::int
                 from public.user_collection_items i
                 join public.places p on p.id = i.place_id
                where i.user_collection_id = c.id and ${placeInPublicCollection}
                  and exists (select from public.visits v
                               where v.user_id = app_current_user_id()
                                 and v.place_id = p.id)) as visited
         from public.user_collections c
        where c.owner_user_id = app_current_user_id()
        order by c.created_at desc, c.id
        limit ?`,
      [MAX_OWN_COLLECTIONS],
    );
  },

  async findOwn(tx, id) {
    const rows = await tx.em.execute<OwnCollectionRow[]>(
      `select c.id, c.title, c.summary, c.region, c.version
         from public.user_collections c
        where c.id = ? and c.owner_user_id = app_current_user_id()`,
      [id],
    );

    return rows[0] ?? null;
  },

  async listEntries(tx, collectionId) {
    const rows = await tx.em.execute<
      {
        id: string;
        position: number;
        placeId: string | null;
        nameSnapshot: string;
        publicName: string | null;
        publicAddress: string | null;
        visited: boolean;
      }[]
    >(
      `select i.id, i.position, i.place_id as "placeId", i.place_name_snapshot as "nameSnapshot",
              p.name as "publicName", p.address as "publicAddress",
              exists (select from public.visits v
                       where v.user_id = app_current_user_id()
                         and v.place_id = i.place_id) as visited
         from public.user_collection_items i
         join public.user_collections c on c.id = i.user_collection_id
         left join public.places p
                on p.id = i.place_id and ${placeInPublicCollection}
        where i.user_collection_id = ? and c.owner_user_id = app_current_user_id()
        order by i.position, i.id
        limit ?`,
      [collectionId, MAX_ITEMS_PER_OWN_COLLECTION],
    );

    return rows.map((row): OwnEntryRow => ({
      id: row.id,
      position: row.position,
      placeId: row.placeId,
      nameSnapshot: row.nameSnapshot,
      place:
        row.publicName === null ? null : { name: row.publicName, address: row.publicAddress ?? "" },
      visited: row.visited,
    }));
  },

  async create(tx, input): Promise<CreateOwnCollectionResult> {
    // The lock is a statement of its own: the statement below then takes its snapshot after the
    // lock is held, so it counts every collection that finished and two simultaneous writes of
    // one actor cannot both take the last place.
    await tx.em.execute(myCollectionsLock);

    const rows = await tx.em.execute<{ id: string | null; ownOk: boolean; listOk: boolean }[]>(
      `with own as (
         select count(*)::int as total
           from public.user_collections
          where owner_user_id = app_current_user_id()
       ), saved as (
         select count(*)::int as total
           from public.saved_collections sc
           join public.collections c on c.id = sc.collection_id
           join public.organizations o on o.id = c.organization_id
          where sc.user_id = app_current_user_id() and ${publishedCollection}
       ), gate as (
         select (select total from own) < ? as own_ok,
                (select total from own) + (select total from saved) < ? as list_ok
       ), created as (
         insert into public.user_collections (title, summary, region)
         select ?, ?, ?
          where (select own_ok and list_ok from gate)
         returning id
       )
       select (select id from created) as id,
              (select own_ok from gate) as "ownOk",
              (select list_ok from gate) as "listOk"`,
      [MAX_OWN_COLLECTIONS, MAX_MY_COLLECTIONS, input.title, input.summary, input.region],
    );
    const row = rows[0];

    if (row?.id) {
      return { status: "created", id: row.id };
    }

    return row?.ownOk === false
      ? { status: "too_many_own_collections" }
      : { status: "my_collections_full" };
  },

  async update(tx, id, version, input): Promise<UpdateOwnCollectionResult> {
    const changed = await tx.em.execute<{ id: string }[]>(
      `update public.user_collections
          set title = ?, summary = ?, region = ?
        where id = ? and owner_user_id = app_current_user_id() and version = ?
        returning id`,
      [input.title, input.summary, input.region, id, version],
    );

    if (changed.length > 0) {
      return "updated";
    }

    // Nothing changed: either the collection is not the actor's (or missing), or it is newer.
    return (await postgresOwnCollectionsRepository.findOwn(tx, id)) === null
      ? "not_found"
      : "stale_version";
  },

  async remove(tx, id) {
    const removed = await tx.em.execute<{ id: string }[]>(
      `delete from public.user_collections
        where id = ? and owner_user_id = app_current_user_id()
        returning id`,
      [id],
    );

    return removed.length > 0;
  },

  async addPlace(tx, collectionId, placeId): Promise<AddEntryResult> {
    await tx.em.execute(
      `select pg_advisory_xact_lock(hashtextextended('user_collection_items:' || ?::text, 0))`,
      [collectionId],
    );

    // One statement: the ownership test, the visibility test, the count and the insert see the
    // same snapshot, so a place withdrawn in between is answered with `not_found`, not with a
    // refusal of the row policy. The position is the next free one.
    const rows = await tx.em.execute<
      { owned: number; visible: number; present: boolean; total: number; inserted: number }[]
    >(
      `with owned as (
         select id from public.user_collections
          where id = ? and owner_user_id = app_current_user_id()
       ), visible as (
         select p.id from public.places p
          where p.id = ? and ${placeInPublicCollection}
       ), held as (
         select count(*)::int as total,
                coalesce(max(position), 0) as last_position,
                coalesce(bool_or(place_id = ?::uuid), false) as present
           from public.user_collection_items
          where user_collection_id = ?
       ), added as (
         insert into public.user_collection_items (user_collection_id, position, place_id)
         select o.id, (select last_position from held) + 1, v.id
           from owned o, visible v
          where (select total from held) < ? and not (select present from held)
         returning id
       )
       select (select count(*) from owned)::int as owned,
              (select count(*) from visible)::int as visible,
              (select present from held) as present,
              (select total from held) as total,
              (select count(*) from added)::int as inserted`,
      [collectionId, placeId, placeId, collectionId, MAX_ITEMS_PER_OWN_COLLECTION],
    );
    const row = rows[0];

    if (row === undefined || row.owned === 0 || row.visible === 0) {
      return "not_found";
    }

    if (row.present) {
      return "already_there";
    }

    return row.inserted === 1 ? "added" : "too_many_items";
  },

  async removeEntry(tx, collectionId, entryId) {
    const removed = await tx.em.execute<{ id: string }[]>(
      `delete from public.user_collection_items
        where id = ? and user_collection_id = ?
        returning id`,
      [entryId, collectionId],
    );

    return removed.length > 0;
  },
};
