import "server-only";

import {
  placeInPublicCollection,
  publishedCollection,
  regionalCollection,
} from "@/features/catalog/infrastructure/public-visibility";

import type { ProfileStatsRepository } from "../application/stats-types";

// Raw SQL on the transaction of the use case (user context). Every statement names the
// owner explicitly (app_current_user_id()); the policies of `visits` do the same in the
// database. Places and collections are filtered to the public ones in the query itself,
// because the policies of a curator would show their own drafts as well.
// Nothing here takes a position of a device: the distances come from stored places (D-14).

export const postgresProfileStatsRepository: ProfileStatsRepository = {
  async readVisitStats(tx) {
    const placeRows = await tx.em.execute<{ count: string }[]>(
      `select count(distinct v.place_id)::text as count
         from public.visits v
         join public.places p on p.id = v.place_id
        where v.user_id = app_current_user_id() and ${placeInPublicCollection}`,
    );
    const regionRows = await tx.em.execute<{ region: string }[]>(
      `select distinct c.region
         from public.visits v
         join public.collection_places cp on cp.place_id = v.place_id
         join public.collections c on c.id = cp.collection_id
         join public.organizations o on o.id = c.organization_id
        where v.user_id = app_current_user_id()
          and ${publishedCollection} and ${regionalCollection}`,
    );
    const visitRows = await tx.em.execute<
      { kind: "on_site" | "past"; visitedAt: string; latitude: number; longitude: number }[]
    >(
      `select v.kind, v.visited_at as "visitedAt", p.latitude, p.longitude
         from public.visits v
         join public.places p on p.id = v.place_id
        where v.user_id = app_current_user_id()
          and v.kind = 'on_site' and ${placeInPublicCollection}
        order by v.visited_at, v.id`,
    );

    return {
      visitedPlaces: Number(placeRows[0]?.count ?? 0),
      regions: regionRows.map((row) => row.region),
      visits: visitRows,
    };
  },
};
