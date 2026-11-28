import "server-only";

import { MAX_APPLICATIONS_PER_ACCOUNT } from "../domain/limits";
import type {
  AdminCuratorApplication,
  CuratorApplicationsRepository,
  FunctionAnswer,
  MyCuratorApplication,
  WithdrawResult,
} from "../application/curator-application-types";

// Raw SQL on the transaction of the use case. The applicant's statements name no account id: the
// owner of a row is app_current_user_id() (the column default, the row policies). The
// administrator's statements are calls of the three functions of Migration20261128040000, which
// take their identity from the context; they return explicit columns only.

const latestApplicationColumns = `
  a.id, a.organization_name as "organizationName", a.organization_kind as "organizationKind",
  a.applicant_role as "applicantRole", a.contact, a.website_url as "websiteUrl", a.status,
  a.created_at as "createdAt", a.rejection_reason as "rejectionReason",
  o.name as "organizationNameCurrent",
  exists (select from public.organization_members m
           where m.organization_id = a.organization_id
             and m.user_id = app_current_user_id()) as "isMember",
  coalesce(o.status = 'approved', false) as "organizationApproved"`;

export const postgresCuratorApplicationsRepository: CuratorApplicationsRepository = {
  async findLatest(tx) {
    const rows = await tx.em.execute<MyCuratorApplication[]>(
      `select ${latestApplicationColumns}
         from public.curator_applications a
         left join public.organizations o on o.id = a.organization_id
        where a.applicant_user_id = app_current_user_id()
        order by a.created_at desc, a.id
        limit 1`,
    );

    return rows[0] ?? null;
  },

  async insert(tx, input) {
    // One lock per account, so two submits at once see each other's row (the unique index and
    // the restrictive policy stay the backstop).
    await tx.em.execute(
      `select pg_advisory_xact_lock(
         hashtextextended('curator_applications:' || app_current_user_id()::text, 0))`,
      [],
      "get",
    );

    const [counts] = await tx.em.execute<{ pending: number; total: number }[]>(
      `select count(*) filter (where status = 'pending')::int as pending, count(*)::int as total
         from public.curator_applications
        where applicant_user_id = app_current_user_id()`,
    );

    if (counts!.pending > 0) {
      return { status: "pending_exists" };
    }
    if (counts!.total >= MAX_APPLICATIONS_PER_ACCOUNT) {
      return { status: "too_many_applications" };
    }

    const [row] = await tx.em.execute<{ id: string }[]>(
      `insert into public.curator_applications
         (organization_name, organization_kind, applicant_role, contact, website_url)
       values (?, ?, ?, ?, ?)
       returning id`,
      [
        input.organizationName,
        input.organizationKind,
        input.applicantRole,
        input.contact,
        input.websiteUrl,
      ],
    );

    return { status: "created", id: row!.id };
  },

  async withdrawLatest(tx): Promise<WithdrawResult> {
    const latest = async () =>
      (
        await tx.em.execute<{ id: string; status: string }[]>(
          `select id, status from public.curator_applications
            where applicant_user_id = app_current_user_id()
            order by created_at desc, id
            limit 1`,
        )
      )[0] ?? null;
    const before = await latest();

    if (before === null) {
      return "not_found";
    }
    if (before.status === "approved") {
      return "already_decided";
    }

    // The policy lets the applicant delete a pending or rejected row only. When the
    // administrator approved it in the meantime, the delete waited for the lock of the row,
    // then matched nothing: the application is read again.
    const deleted = await tx.em.execute<{ id: string }[]>(
      `delete from public.curator_applications where id = ? returning id`,
      [before.id],
    );

    if (deleted.length > 0) {
      return "deleted";
    }

    const after = await latest();

    return after !== null && after.status === "approved" ? "already_decided" : "not_found";
  },

  async listForAdmin(tx, status) {
    return tx.em.execute<AdminCuratorApplication[]>(
      `select id, organization_name as "organizationName", organization_kind as "organizationKind",
              applicant_role as "applicantRole", contact, website_url as "websiteUrl",
              applicant_email as "applicantEmail", status, created_at as "createdAt",
              decided_at as "decidedAt", rejection_reason as "rejectionReason",
              organization_id as "organizationId",
              organization_name_current as "organizationNameCurrent",
              applicant_is_member as "applicantIsMember"
         from public.app_admin_curator_applications(?::text)`,
      [status],
    );
  },

  async decide(tx, applicationId, decision) {
    const target =
      decision.decision === "approve"
        ? decision.target.kind === "existing"
          ? { organizationId: decision.target.organizationId, name: null, slug: null }
          : { organizationId: null, name: decision.target.name, slug: decision.target.slug }
        : { organizationId: null, name: null, slug: null };
    const [row] = await tx.em.execute<FunctionAnswer[]>(
      `select outcome, code, organization_id as "organizationId"
         from public.app_admin_decide_curator_application(
                ?::uuid, ?::text, ?::uuid, ?::text, ?::text, ?::text)`,
      [
        applicationId,
        decision.decision,
        target.organizationId,
        target.name,
        target.slug,
        decision.decision === "reject" ? decision.reason : null,
      ],
    );

    return row!;
  },

  async revoke(tx, applicationId, reason) {
    const [row] = await tx.em.execute<
      { outcome: FunctionAnswer["outcome"]; code: string | null }[]
    >(`select outcome, code from public.app_admin_revoke_curator(?::uuid, ?::text)`, [
      applicationId,
      reason,
    ]);

    return { outcome: row!.outcome, code: row!.code, organizationId: null };
  },
};
