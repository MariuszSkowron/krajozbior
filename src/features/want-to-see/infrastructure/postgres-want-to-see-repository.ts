import "server-only";

import type { WantToSeePlace, WantToSeeRepository } from "../application/want-to-see-types";
import { MAX_WANT_TO_SEE_LISTED } from "../domain/limits";

// Raw SQL on the transaction of the use case (user context). No statement takes
// a user id: the owner of a row is app_current_user_id(), and the row policies of
// want_to_see_places (owner only) decide what is read or removed. "Publicly
// visible" is spelled out wherever a place is shown or added: the policies of a
// curator also show their own drafts, so a place only in a draft or in a
// withdrawn collection must never appear on the list (spec 7, withdrawal).

const publicPlace = (place: string) => `
  exists (
    select
      from public.collection_places cp
      join public.collections c on c.id = cp.collection_id
      join public.organizations o on o.id = c.organization_id
     where cp.place_id = ${place}
       and c.status = 'published'
       and o.status = 'approved'
  )`;

type ListRow = {
  id: string;
  name: string;
  address: string;
  savedAt: Date | string;
  visited: boolean;
};

export const postgresWantToSeeRepository: WantToSeeRepository = {
  async listPlaces(tx) {
    // "visited" reads only the actor's own visits (owner filter plus the row
    // policy of visits); it is one flag, never a date or a count.
    const rows = await tx.em.execute<ListRow[]>(
      `select p.id, p.name, p.address, w.saved_at as "savedAt",
              exists (
                select from public.visits v
                 where v.user_id = app_current_user_id() and v.place_id = p.id
              ) as visited
         from public.want_to_see_places w
         join public.places p on p.id = w.place_id
        where w.user_id = app_current_user_id() and ${publicPlace("p.id")}
        order by w.saved_at desc, p.id
        limit ?`,
      [MAX_WANT_TO_SEE_LISTED],
    );

    return rows.map((row): WantToSeePlace => ({
      id: row.id,
      name: row.name,
      address: row.address,
      savedAt: new Date(row.savedAt),
      visited: row.visited,
    }));
  },

  async isPubliclyVisiblePlace(tx, placeId) {
    const rows = await tx.em.execute<{ ok: boolean }[]>(
      `select true as ok where ${publicPlace("?::uuid")}`,
      [placeId],
    );

    return rows.length > 0;
  },

  async addPlace(tx, placeId) {
    // The lock is a statement of its own: the statement below then takes its
    // snapshot after the lock is held, so it counts every add that finished and
    // two simultaneous adds of one actor cannot both take the last place.
    await tx.em.execute(
      `select pg_advisory_xact_lock(
         hashtextextended('want_to_see_places:' || app_current_user_id()::text, 0))`,
    );

    // One statement: the visibility test, the count and the insert see the same
    // snapshot, so a place withdrawn in between is answered with `not_found`, not
    // with a refusal of the row policy. A repeated add conflicts and changes
    // nothing, also when the actor is at the limit. The count is of the places
    // the list shows (publicly visible ones).
    const rows = await tx.em.execute<{ visible: number; allowed: boolean }[]>(
      `with target as (
         select p.id from public.places p where p.id = ?::uuid and ${publicPlace("p.id")}
       ), held as (
         select count(*)::int as total
           from public.want_to_see_places w
          where w.user_id = app_current_user_id() and ${publicPlace("w.place_id")}
       ), allowed as (
         select exists (
                  select from public.want_to_see_places
                   where user_id = app_current_user_id() and place_id = ?::uuid
                ) or (select total from held) < ? as ok
       ), added as (
         insert into public.want_to_see_places (user_id, place_id)
         select app_current_user_id(), id from target
          where (select ok from allowed)
         on conflict (user_id, place_id) do nothing
       )
       select (select count(*) from target)::int as visible,
              (select ok from allowed) as allowed`,
      [placeId, placeId, MAX_WANT_TO_SEE_LISTED],
    );

    if ((rows[0]?.visible ?? 0) === 0) {
      return "not_found";
    }

    return rows[0]?.allowed === true ? "added" : "too_many";
  },

  async removePlace(tx, placeId) {
    await tx.em.execute(
      `delete from public.want_to_see_places
        where user_id = app_current_user_id() and place_id = ?`,
      [placeId],
    );
  },

  async isPlaceWanted(tx, placeId) {
    const rows = await tx.em.execute<{ ok: boolean }[]>(
      `select true as ok from public.want_to_see_places
        where user_id = app_current_user_id() and place_id = ?`,
      [placeId],
    );

    return rows.length > 0;
  },
};
