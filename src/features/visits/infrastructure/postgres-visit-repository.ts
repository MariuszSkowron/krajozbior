import "server-only";

import type { VisitFunctionRow, VisitRepository } from "../application/visit-types";
import type { DatePrecision } from "../domain/past-visit-request";

// "Publicly visible" is spelled out wherever a place gets a new visit: the
// policies of a curator also show their own drafts, so a place only in a draft
// or in a withdrawn collection must never be marked (same rule as the restrictive
// insert policy of visits and the want-to-see list).
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

// Raw SQL on the transaction of the use case (user context). The reading of
// the device is passed only as parameters of the one function call: debug
// logging of queries is off (src/lib/db/config.ts) and nothing here logs.
export const postgresVisitRepository: VisitRepository = {
  async recordOnSiteVisit(tx, placeId, request) {
    const rows = await tx.em.execute<VisitFunctionRow[]>(
      `select result, distance_m
         from public.record_on_site_visit(?::uuid, ?::float8, ?::float8, ?::float8, ?::uuid)`,
      [placeId, request.latitude, request.longitude, request.accuracyM, request.clientVisitId],
    );
    const row = rows[0];

    if (row === undefined) {
      throw new Error("The visit function returned no row");
    }

    return row;
  },

  async findOwnVisitPlaceId(tx, clientVisitId) {
    const rows = await tx.em.execute<{ place_id: string }[]>(
      `select place_id from public.visits
        where user_id = app_current_user_id() and client_visit_id = ?::uuid
        limit 1`,
      [clientVisitId],
    );

    return rows[0]?.place_id ?? null;
  },

  async hasVisitedPlace(tx, placeId) {
    const rows = await tx.em.execute<{ ok: boolean }[]>(
      `select true as ok from public.visits
        where user_id = app_current_user_id() and place_id = ?
        limit 1`,
      [placeId],
    );

    return rows.length > 0;
  },

  async getMyVisitOfPlace(tx, placeId) {
    const rows = await tx.em.execute<
      { kind: string; visitedOn: string | null; precision: string | null }[]
    >(
      `select kind, visited_on::text as "visitedOn", date_precision as precision
         from public.visits
        where user_id = app_current_user_id() and place_id = ?::uuid
        order by created_at desc, id`,
      [placeId],
    );
    const past = rows.find((row) => row.kind === "past");

    return {
      onSite: rows.some((row) => row.kind === "on_site"),
      past:
        past === undefined
          ? null
          : { precision: past.precision as DatePrecision, visitedOn: past.visitedOn },
    };
  },

  async listMyVisitKindsOfCollection(tx, collectionId) {
    const rows = await tx.em.execute<{ placeId: string; onSite: boolean }[]>(
      `select cp.place_id as "placeId", bool_or(v.kind = 'on_site') as "onSite"
         from public.collection_places cp
         join public.visits v on v.place_id = cp.place_id
        where cp.collection_id = ?::uuid and v.user_id = app_current_user_id()
        group by cp.place_id`,
      [collectionId],
    );

    return rows.map((row) => ({
      placeId: row.placeId,
      kind: row.onSite ? ("on_site" as const) : ("past" as const),
    }));
  },

  async markPastVisits(tx, placeIds, { visitedOn, precision }) {
    // The lock is a statement of its own: the statement below then takes its
    // snapshot after the lock is held, so two simultaneous batches of one actor
    // cannot both add a row for the same place (lock released at commit).
    await tx.em.execute(
      `select pg_advisory_xact_lock(
         hashtextextended('visits_past:' || app_current_user_id()::text, 0))`,
    );

    // One statement: the visibility test, the count and the insert see the same
    // snapshot. Nothing is written unless EVERY requested place is publicly
    // visible (a place withdrawn in between is "not visible", not an error of
    // the row policy). A place the actor already has a visit of gets no row.
    const rows = await tx.em.execute<{ visible: number; recorded: number }[]>(
      `with target as (
         select p.id
           from public.places p
          where p.id in (select x::uuid from jsonb_array_elements_text(?::jsonb) x)
            and ${publicPlace("p.id")}
       ), added as (
         insert into public.visits (user_id, place_id, kind, visited_on, date_precision)
         select app_current_user_id(), t.id, 'past', ?::date, ?::text
           from target t
          where (select count(*) from target) = ?::int
            and not exists (
              select from public.visits v
               where v.user_id = app_current_user_id() and v.place_id = t.id
            )
         returning 1
       )
       select (select count(*) from target)::int as visible,
              (select count(*) from added)::int as recorded`,
      [JSON.stringify(placeIds), visitedOn, precision, placeIds.length],
    );
    const row = rows[0];

    if (row === undefined) {
      throw new Error("The past visit statement returned no row");
    }

    return row;
  },

  async deleteMyPastVisits(tx, placeId) {
    const rows = await tx.em.execute<{ removed: number }[]>(
      `with removed as (
         delete from public.visits
          where user_id = app_current_user_id() and place_id = ?::uuid and kind = 'past'
         returning 1
       )
       select count(*)::int as removed from removed`,
      [placeId],
    );

    return rows[0]?.removed ?? 0;
  },
};
