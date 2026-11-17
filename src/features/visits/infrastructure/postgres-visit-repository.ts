import "server-only";

import type { VisitFunctionRow, VisitRepository } from "../application/visit-types";

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

  async hasVisitedPlace(tx, placeId) {
    const rows = await tx.em.execute<{ ok: boolean }[]>(
      `select true as ok from public.visits
        where user_id = app_current_user_id() and place_id = ?
        limit 1`,
      [placeId],
    );

    return rows.length > 0;
  },
};
