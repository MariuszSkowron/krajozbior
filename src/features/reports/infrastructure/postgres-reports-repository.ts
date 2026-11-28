import "server-only";

import type { MyReport, QueueItem, ReportsRepository } from "../application/report-types";

// Raw SQL on the transaction of the use case (user context), so the functions of the database
// and their `app_org_permission` checks decide what is seen. The curator reads and decides only
// through the three functions of the migration; the columns of the result never hold an author
// id, an e-mail or the id of the deciding curator.

const REFUSALS = [
  "stale_version",
  "author_gone",
  "own_report",
  "invalid_state",
  "duplicate_open",
] as const;

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

// The driver error that carries a SQLSTATE and a constraint name (maybe wrapped by the ORM).
function driverError(error: unknown): { code?: string; constraint?: string } {
  const { code, constraint, cause } = (error ?? {}) as {
    code?: unknown;
    constraint?: unknown;
    cause?: unknown;
  };

  if (typeof code === "string") {
    return { code, constraint: typeof constraint === "string" ? constraint : undefined };
  }

  return cause === undefined ? {} : driverError(cause);
}

const timeText = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

export const postgresReportsRepository: ReportsRepository = {
  async insertReport(tx, { placeId, category, message }) {
    try {
      // A savepoint: a refusal of the database (a limit, a duplicate, a policy) aborts only it,
      // so the transaction can still read what is needed to say why.
      const rows = await tx.em.transactional((inner) =>
        inner.execute<{ id: string }[]>(
          `insert into public.place_reports (place_id, category, message)
           values (?::uuid, ?::text, ?::text)
           returning id`,
          [placeId, category, message],
        ),
      );
      const id = rows[0]!.id;
      const organization = await tx.em.execute<{ name: string }[]>(
        `select o.name
           from public.place_reports r
           join public.organizations o on o.id = r.organization_id
          where r.id = ?::uuid`,
        [id],
      );

      return { status: "ok", id, organizationName: organization[0]?.name ?? "" };
    } catch (error) {
      const { code, constraint } = driverError(error);

      if (code === "P0001") {
        if (constraint === "report_daily_limit") {
          return { status: "daily_limit" };
        }

        if (constraint === "report_open_limit") {
          return { status: "open_limit" };
        }

        if (constraint === "report_place_limit") {
          return { status: "place_queue_full" };
        }
      }

      if (code === "23505" && constraint === "place_reports_one_open_idx") {
        return { status: "duplicate_open" };
      }

      if (code === "42501") {
        // The policy refused: a place that does not exist or is not public looks the same
        // ("not found"); a place of the author's own organization has its own answer.
        const place = await tx.em.execute<{ own: boolean }[]>(
          `select app_org_permission(p.organization_id) is not null as own
             from public.places p
            where p.id = ?::uuid`,
          [placeId],
        );

        return place[0]?.own === true ? { status: "own_organization" } : { status: "not_found" };
      }

      throw error;
    }
  },

  async listMine(tx) {
    const rows = await tx.em.execute<
      (Omit<MyReport, "createdAt" | "decidedAt" | "placeDeleted"> & {
        createdAt: string;
        decidedAt: string | null;
      })[]
    >(
      `select r.id, r.category, r.status, r.reject_reason as "rejectReason",
              r.decision_note as "decisionNote",
              ${timeText("r.created_at")} as "createdAt",
              ${timeText("r.decided_at")} as "decidedAt",
              r.place_id as "placeId", r.place_name_snapshot as "placeName",
              coalesce((select o.name from public.organizations o where o.id = r.organization_id), '')
                as "organizationName"
         from public.place_reports r
        where r.author_id = app_current_user_id()
        order by r.created_at desc, r.id
        limit 200`,
    );

    return rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt),
      decidedAt: row.decidedAt === null ? null : new Date(row.decidedAt),
      placeDeleted: row.placeId === null,
    }));
  },

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
    // Times go out as ISO text in UTC (a raw timestamp comes back as a driver string).
    const rows = await tx.em.execute<
      (Omit<QueueItem, "editCollectionId" | "createdAt" | "decidedAt"> & {
        createdAt: string;
        decidedAt: string | null;
      })[]
    >(
      `select q.id, q.category, q.message, q.status, q.reject_reason as "rejectReason",
              q.decision_note as "decisionNote",
              to_char(q.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "createdAt",
              to_char(q.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "decidedAt",
              q.version, q.place_id as "placeId",
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
      createdAt: new Date(row.createdAt),
      decidedAt: row.decidedAt === null ? null : new Date(row.decidedAt),
      editCollectionId: row.placeId === null ? null : (collections.get(row.placeId) ?? null),
    }));
  },

  async decide(tx, { reportId, action, reason, note, version }) {
    try {
      // A savepoint: a refusal of the function is an exception, and without it the whole
      // transaction would stay aborted after the refusal was caught.
      const rows = await tx.em.transactional((inner) =>
        inner.execute<{ version: number }[]>(
          `select public.app_decide_report(?::uuid, ?::text, ?::text, ?::text, ?::integer) as version`,
          [reportId, action, reason, note, version],
        ),
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

      // The function refuses a duplicate before the update; the index is the last word if the
      // organization of the place changed in between.
      const driver = driverError(error);

      if (driver.code === "23505" && driver.constraint === "place_reports_one_open_idx") {
        return { status: "conflict", reason: "duplicate_open" };
      }

      throw error;
    }
  },
};
