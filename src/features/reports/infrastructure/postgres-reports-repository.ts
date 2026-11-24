import "server-only";

import type { QueueItem, ReportsRepository } from "../application/report-types";

// Raw SQL on the transaction of the use case (user context), so the functions of the database
// and their `app_org_permission` checks decide what is seen. The curator reads and decides only
// through the three functions of the migration; the columns of the result never hold an author
// id, an e-mail or the id of the deciding curator.

const REFUSALS = ["stale_version", "author_gone", "own_report", "invalid_state"] as const;

// A refusal of `app_decide_report` is an exception with SQLSTATE P0001 whose `constraint` field
// carries the code (the message is cut out of errors that reach a log in production, see
// src/lib/db/database-error.ts). The driver error may be wrapped.
function refusalCode(error: unknown): string | null {
  const { code, constraint, cause } = (error ?? {}) as {
    code?: unknown;
    constraint?: unknown;
    cause?: unknown;
  };

  if (code === "P0001" && typeof constraint === "string") {
    return constraint;
  }

  return cause === undefined ? null : refusalCode(cause);
}

export const postgresReportsRepository: ReportsRepository = {
  async permittedOrganizationIds(tx) {
    const rows = await tx.em.execute<{ id: string }[]>(
      `select o.id
         from public.organizations o
        where app_org_permission(o.id) is not null
        order by o.name, o.id`,
    );

    return rows.map((row) => row.id);
  },

  async countOpen(tx, organizationId) {
    const rows = await tx.em.execute<{ count: number }[]>(
      `select public.app_report_counts(?::uuid) as count`,
      [organizationId],
    );

    return rows[0]?.count ?? 0;
  },

  async listQueue(tx, organizationId, state) {
    const rows = await tx.em.execute<Omit<QueueItem, "editCollectionId">[]>(
      `select q.id, q.category, q.message, q.status, q.reject_reason as "rejectReason",
              q.decision_note as "decisionNote", q.created_at as "createdAt",
              q.decided_at as "decidedAt", q.version, q.place_id as "placeId",
              q.place_name as "placeName", q.place_deleted as "placeDeleted",
              q.author_label as "authorLabel", q.author_gone as "authorGone"
         from public.app_report_queue(?::uuid, ?::text, null::integer) q`,
      [organizationId, state],
    );

    // The link "Edytuj miejsce": the smallest id of a collection of this organization that
    // holds the place. Read as the curator through the policies of the panel, so a collection
    // taken back to a draft counts too. `null` for a removed place or one in no collection.
    const placeIds = [
      ...new Set(rows.flatMap((row) => (row.placeId === null ? [] : [row.placeId]))),
    ];
    const collections = new Map<string, string>();

    if (placeIds.length > 0) {
      const found = await tx.em.execute<{ placeId: string; collectionId: string }[]>(
        `select cp.place_id as "placeId",
                (array_agg(cp.collection_id order by cp.collection_id::text))[1] as "collectionId"
           from public.collection_places cp
           join public.collections c on c.id = cp.collection_id
          where cp.place_id::text = any (string_to_array(?, ','))
            and c.organization_id = ?::uuid
            and app_org_permission(c.organization_id) is not null
          group by cp.place_id`,
        [placeIds.join(","), organizationId],
      );

      for (const row of found) {
        collections.set(row.placeId, row.collectionId);
      }
    }

    return rows.map((row) => ({
      ...row,
      editCollectionId: row.placeId === null ? null : (collections.get(row.placeId) ?? null),
    }));
  },

  async decide(tx, { reportId, action, reason, note, version }) {
    try {
      const rows = await tx.em.execute<{ version: number }[]>(
        `select public.app_decide_report(?::uuid, ?::text, ?::text, ?::text, ?::integer) as version`,
        [reportId, action, reason, note, version],
      );

      return { status: "ok", version: rows[0]!.version };
    } catch (error) {
      const code = refusalCode(error);

      if (code === "not_found") {
        return { status: "not_found" };
      }

      if (code === "invalid_argument") {
        return { status: "invalid" };
      }

      const reasonCode = REFUSALS.find((item) => item === code);

      if (reasonCode !== undefined) {
        return { status: "conflict", reason: reasonCode };
      }

      throw error;
    }
  },
};
