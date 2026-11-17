import "server-only";

import type { WantToSeePlace, WantToSeeRepository } from "../application/want-to-see-types";

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

type ListRow = { id: string; name: string; address: string; savedAt: Date | string };

export const postgresWantToSeeRepository: WantToSeeRepository = {
  async listPlaces(tx) {
    const rows = await tx.em.execute<ListRow[]>(
      `select p.id, p.name, p.address, w.saved_at as "savedAt"
         from public.want_to_see_places w
         join public.places p on p.id = w.place_id
        where w.user_id = app_current_user_id() and ${publicPlace("p.id")}
        order by w.saved_at desc, p.id`,
    );

    return rows.map((row): WantToSeePlace => ({
      id: row.id,
      name: row.name,
      address: row.address,
      savedAt: new Date(row.savedAt),
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
    await tx.em.execute(
      `insert into public.want_to_see_places (user_id, place_id)
       values (app_current_user_id(), ?)
       on conflict (user_id, place_id) do nothing`,
      [placeId],
    );
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
