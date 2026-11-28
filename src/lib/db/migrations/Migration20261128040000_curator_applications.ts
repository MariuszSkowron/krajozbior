import { Migration } from "@mikro-orm/migrations";

// P7/P8 (spec "Rola kuratora", sections 5.1 and 6; decision D-59): applications for the curator
// role and the three functions of the administrator that grant or take the role.
//
// 1. `curator_applications` is class CUR (the applicant and, through functions only, the
//    administrator). The applicant writes and withdraws their own row through row security;
//    nobody updates a row directly: a decision is the function below.
// 2. The tables `organizations`, `organization_members` and `operations_audit` get narrow write
//    policies `to krajozbior_owner`. They hold only while the transaction variable
//    `krajozbior.curator_panel_write` is on AND the session user is krajozbior_app, so a login as
//    the owner cannot write either. THE SWITCH IS NOT A SECURITY BOUNDARY AGAINST THE APPLICATION:
//    krajozbior_app may set the variable itself. Against it the boundary is the check of the
//    administrator inside each function (`app_require_live_admin`).
// 3. `app_require_live_admin()` demands the role `admin` in the database AND a live session of
//    that account: a row of `auth.sessions` whose token equals `app.session_token` (set by the
//    application for the transaction, `withAdminContext`), not expired, created at most 12 hours
//    ago (the longest session of an administrator). `created_at` is not refreshed when a session is
//    renewed, so the 12 hours count from the sign-in. Only the owner may execute it.
// 4. Weakening, stated in D-59: the guarantee "a plain account never becomes a curator by any
//    route or raw SQL" now holds only together with the identifier AND the live session token of
//    the administrator. Compensation: role and session checked here, an entry in
//    `operations_audit`, the panel switch of the application. To be replaced by
//    `krajozbior_platform` and the second login step (E10-2, DT-E10-9) after the contest.
// 5. Every function runs with `search_path = ''`, so every name carries its schema. Each function
//    turns the switch on before its first write and off again before its only exit; a refusal that
//    is an exception rolls the transaction back together with the variable.
//
// The migration is frozen: the lists below are copies of the code (ORGANIZATION_KINDS, the slug
// pattern); an integration test compares them.

const organizationKinds = `'municipality', 'pttk', 'local_tourism_org', 'regional_tourism_org', 'person', 'other'`;
// Unicode category Cc (C0, DEL, C1): no line breaks or terminal escapes; and all invisible
// formatting characters of category Cf (soft hyphen, Arabic marks, zero-width, direction marks and
// overrides, word joiner, isolates, BOM, interlinear and musical format marks, language tags), as
// the form refuses with /[\p{Cc}\p{Cf}]/u (C-05 of the audit). Escapes (\UXXXXXXXX) are read by the
// PostgreSQL regex engine, so no invisible character sits in this file.
const controlCharacters = String.raw`'[\U00000001-\U0000001f\U0000007f-\U0000009f\U000000ad\U00000600-\U00000605\U0000061c\U000006dd\U0000070f\U00000890-\U00000891\U000008e2\U0000180e\U0000200b-\U0000200f\U0000202a-\U0000202e\U00002060-\U00002064\U00002066-\U0000206f\U0000feff\U0000fff9-\U0000fffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'`;
// The organization name is a closed set (frozen copy of ORGANIZATION_NAME_PATTERN): Latin letters
// as explicit code ranges (Latin-1 without the signs x and division, Latin Extended-A and B without
// U+01C0-U+01C3, Latin Extended Additional), digits, a space and . , : ; ! ? ' right quote " low
// and right double quotes ( ) & / + en dash and hyphen. No other script, so no look-alike letters.
const organizationNamePattern = String.raw`'^[A-Za-z0-9\U000000c0-\U000000d6\U000000d8-\U000000f6\U000000f8-\U000001bf\U000001c4-\U0000024f\U00001e00-\U00001eff .,:;!?''\U00002019"\U0000201e\U0000201d()&/+\U00002013-]+$'`;
const slugPattern = `'^[a-z0-9]+(-[a-z0-9]+)*$'`;
const maxApplicationsPerAccount = 20;
const maxListedApplications = 200;

const gate = `current_setting('krajozbior.curator_panel_write', true) = 'on' and session_user = 'krajozbior_app'`;

const decideSignature = `uuid, text, uuid, text, text, text`;
const revokeSignature = `uuid, text`;
const listSignature = `text`;

export class Migration20261128040000_curator_applications extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table curator_applications (
        id uuid primary key default gen_random_uuid(),
        applicant_user_id uuid not null default app_current_user_id()
          references auth.users (id) on delete cascade,
        organization_name text not null check (
          organization_name = btrim(organization_name)
          and char_length(organization_name) between 1 and 120
          and organization_name !~ ${controlCharacters}
          and organization_name ~ ${organizationNamePattern}
          and organization_name !~ '  '
        ),
        organization_kind text not null check (organization_kind in (${organizationKinds})),
        applicant_role text not null check (
          applicant_role = btrim(applicant_role)
          and char_length(applicant_role) between 1 and 120
          and applicant_role !~ ${controlCharacters}
        ),
        contact text not null check (
          contact = btrim(contact)
          and char_length(contact) between 3 and 120
          and contact !~ ${controlCharacters}
        ),
        website_url text null check (
          char_length(website_url) <= 200
          and website_url ~ '^https://'
          and website_url !~ ${controlCharacters}
        ),
        status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
        created_at timestamptz not null default now(),
        decided_at timestamptz null,
        decided_by uuid null references auth.users (id) on delete set null,
        rejection_reason text null check (
          char_length(rejection_reason) between 1 and 400
          and rejection_reason !~ ${controlCharacters}
        ),
        organization_id uuid null references organizations (id),
        constraint curator_applications_state_check check (
          (status = 'pending') = (decided_at is null)
          and (status = 'rejected') = (rejection_reason is not null)
          and (status = 'approved') = (organization_id is not null)
        )
      );
    `);

    // One pending application per account (a second one ends with 23505).
    this.addSql(`
      create unique index curator_applications_one_pending_idx
        on curator_applications (applicant_user_id) where status = 'pending';
    `);
    this.addSql(
      `create index curator_applications_applicant_idx on curator_applications (applicant_user_id);`,
    );
    this.addSql(
      `create index curator_applications_status_created_idx on curator_applications (status, created_at);`,
    );
    // Foreign keys without an index: the delete of an account and the list use these.
    this.addSql(
      `create index curator_applications_decided_by_idx on curator_applications (decided_by);`,
    );
    this.addSql(
      `create index curator_applications_organization_idx on curator_applications (organization_id);`,
    );

    this.addSql(`alter table curator_applications enable row level security;`);
    // FORCE: the table owner is bound by the policies too.
    this.addSql(`alter table curator_applications force row level security;`);
    this.addSql(
      `revoke all on curator_applications from public, krajozbior_app, krajozbior_auth, krajozbior_ops;`,
    );
    // No UPDATE, TRUNCATE, REFERENCES or TRIGGER; no INSERT on the applicant, the status or the
    // decision columns (the database fills them).
    this.addSql(`
      grant select, delete on curator_applications to krajozbior_app;
    `);
    this.addSql(`
      grant insert (organization_name, organization_kind, applicant_role, contact, website_url)
        on curator_applications to krajozbior_app;
    `);

    this.addSql(`
      create policy curator_applications_own_select on curator_applications
        for select to krajozbior_app
        using (applicant_user_id = (select app_current_user_id()));
    `);
    this.addSql(`
      create policy curator_applications_own_insert on curator_applications
        for insert to krajozbior_app
        with check (applicant_user_id = (select app_current_user_id()) and status = 'pending');
    `);
    // The count goes through a function of the owner: a policy that reads its own table in a
    // subquery fails with "infinite recursion detected in policy" (42P17). The function counts
    // only the rows of the caller (`app_current_user_id()`), nobody else's.
    this.addSql(`
      create function app_my_curator_application_count() returns bigint
      language sql stable security definer
      set search_path = ''
      as $$
        select pg_catalog.count(*) from public.curator_applications c
         where c.applicant_user_id = public.app_current_user_id()
      $$;
    `);
    this.addSql(`revoke all on function app_my_curator_application_count() from public;`);
    this.addSql(`grant execute on function app_my_curator_application_count() to krajozbior_app;`);
    this.addSql(`
      create policy curator_applications_insert_limit on curator_applications
        as restrictive for insert to krajozbior_app
        with check ((select app_my_curator_application_count()) < ${maxApplicationsPerAccount});
    `);
    // Withdraw a pending application or remove a rejected one; an approved one stays (history).
    this.addSql(`
      create policy curator_applications_own_delete on curator_applications
        for delete to krajozbior_app
        using (
          applicant_user_id = (select app_current_user_id())
          and status in ('pending', 'rejected')
        );
    `);
    // The functions run as the owner; these hold only inside them.
    this.addSql(`
      create policy curator_applications_function_select on curator_applications
        for select to krajozbior_owner using (true);
    `);
    this.addSql(`
      create policy curator_applications_panel_update on curator_applications
        for update to krajozbior_owner
        using (${gate}) with check (${gate});
    `);

    // The gated write policies of the owner on the three existing tables.
    this.addSql(`
      create policy organizations_panel_insert on organizations
        for insert to krajozbior_owner
        with check (${gate} and status = 'approved');
    `);
    this.addSql(`
      create policy organization_members_panel_insert on organization_members
        for insert to krajozbior_owner
        with check (${gate});
    `);
    this.addSql(`
      create policy organization_members_panel_delete on organization_members
        for delete to krajozbior_owner
        using (${gate});
    `);
    this.addSql(`
      create policy operations_audit_panel_insert on operations_audit
        for insert to krajozbior_owner
        with check (
          ${gate}
          and operation in ('grant_curator', 'revoke_curator')
          and outcome = 'applied'
          and error_code is null
          and details is null
        );
    `);

    // The live administrator. No EXECUTE for any role but the owner.
    this.addSql(`
      create function app_require_live_admin() returns void
      language plpgsql security definer
      set search_path = ''
      as $$
      begin
        if not exists (
          select
            from auth.users u
            join auth.sessions s on s.user_id = u.id
           where u.id = public.app_current_user_id()
             and u.role = 'admin'
             and s.token = nullif(pg_catalog.current_setting('app.session_token', true), '')
             and s.expires_at > pg_catalog.now()
             and s.created_at > pg_catalog.now() - interval '12 hours'
        ) then
          raise exception 'a live administrator session is required' using errcode = '42501';
        end if;
      end
      $$;
    `);
    this.addSql(`revoke all on function app_require_live_admin() from public;`);

    // The list: explicit columns only, at most 200 rows. The e-mail of the account is for the
    // check of the domain of the institution (E10 Q3).
    this.addSql(`
      create function app_admin_curator_applications(p_status text)
      returns table (
        id uuid, organization_name text, organization_kind text, applicant_role text,
        contact text, website_url text, applicant_email text, status text,
        created_at timestamptz, decided_at timestamptz, rejection_reason text,
        organization_id uuid, organization_name_current text, applicant_is_member boolean
      )
      language plpgsql security definer
      set search_path = ''
      as $$
      #variable_conflict use_column
      begin
        perform public.app_require_live_admin();

        if p_status is null or p_status not in ('pending', 'approved', 'rejected') then
          raise exception 'invalid status' using errcode = '22023';
        end if;

        return query
          select a.id, a.organization_name, a.organization_kind, a.applicant_role, a.contact,
                 a.website_url, u.email, a.status, a.created_at, a.decided_at,
                 a.rejection_reason, a.organization_id, o.name,
                 -- True only for the newest approved application of the pair (person,
                 -- organization) while the membership still exists.
                 (a.status = 'approved'
                  and exists (select from public.organization_members m
                               where m.organization_id = a.organization_id
                                 and m.user_id = a.applicant_user_id)
                  and not exists (select from public.curator_applications n
                                   where n.applicant_user_id = a.applicant_user_id
                                     and n.organization_id = a.organization_id
                                     and n.status = 'approved'
                                     and (n.decided_at, n.id) > (a.decided_at, a.id)))
            from public.curator_applications a
            join auth.users u on u.id = a.applicant_user_id
            left join public.organizations o on o.id = a.organization_id
           where a.status = p_status
           order by case when p_status = 'pending' then a.created_at end asc,
                    a.decided_at desc nulls last, a.id
           limit ${maxListedApplications};
      end
      $$;
    `);

    // Approve or reject. One transaction: the application, the organization, the membership and
    // the audit entry appear together or not at all. A refusal changes nothing; it is not written
    // to the audit (the application keeps its own decision, author and reason).
    this.addSql(`
      create function app_admin_decide_curator_application(
        p_application_id uuid, p_decision text, p_organization_id uuid,
        p_organization_name text, p_organization_slug text, p_reason text
      )
      returns table (outcome text, code text, organization_id uuid)
      language plpgsql security definer
      set search_path = ''
      as $$
      #variable_conflict use_column
      declare
        v_app public.curator_applications;
        v_org public.organizations;
        v_applicant_role text;
        v_created boolean := false;
        v_outcome text := 'applied';
        v_code text := null;
        v_result_org uuid := null;
      begin
        perform public.app_require_live_admin();

        if p_decision is null or p_decision not in ('approve', 'reject') then
          raise exception 'invalid decision' using errcode = '22023';
        end if;

        -- On before the first write (the lock of the row below needs the update policy), off
        -- before the only exit.
        perform pg_catalog.set_config('krajozbior.curator_panel_write', 'on', true);

        <<run>>
        loop
          v_app := (select a from public.curator_applications a where a.id = p_application_id for update);

          if v_app.id is null then
            v_outcome := 'refused'; v_code := 'not_found'; exit run;
          end if;
          if v_app.status <> 'pending' then
            v_outcome := 'refused'; v_code := 'not_pending'; exit run;
          end if;

          if p_decision = 'reject' then
            if p_reason is null
               or char_length(btrim(p_reason)) not between 1 and 400
               or p_reason ~ ${controlCharacters} then
              raise exception 'invalid reason' using errcode = '22023';
            end if;

            update public.curator_applications
               set status = 'rejected', decided_at = pg_catalog.now(),
                   decided_by = public.app_current_user_id(), rejection_reason = btrim(p_reason)
             where id = v_app.id;
            exit run;
          end if;

          v_applicant_role := (select u.role from auth.users u where u.id = v_app.applicant_user_id);
          if v_applicant_role is distinct from 'user' then
            v_outcome := 'refused'; v_code := 'admin_cannot_be_member'; exit run;
          end if;

          if p_organization_id is null then
            if p_organization_name is null
               or char_length(btrim(p_organization_name)) not between 1 and 120
               or p_organization_name ~ ${controlCharacters}
               or btrim(p_organization_name) !~ ${organizationNamePattern}
               or btrim(p_organization_name) ~ '  '
               or p_organization_slug is null
               or char_length(p_organization_slug) > 60
               or p_organization_slug !~ ${slugPattern} then
              raise exception 'invalid organization' using errcode = '22023';
            end if;

            v_org.id := pg_catalog.gen_random_uuid();
            v_org.name := btrim(p_organization_name);
            v_org.slug := p_organization_slug;
            v_org.kind := v_app.organization_kind;
            begin
              insert into public.organizations (id, name, slug, kind, status)
              values (v_org.id, v_org.name, v_org.slug, v_org.kind, 'approved');
            exception when unique_violation then
              -- Nothing is written before this insert, so nothing is left to undo.
              v_outcome := 'refused'; v_code := 'slug_taken'; exit run;
            end;
            v_created := true;
          else
            v_org := (select o from public.organizations o
                       where o.id = p_organization_id and o.status = 'approved');
            if v_org.id is null then
              v_outcome := 'refused'; v_code := 'organization_not_found'; exit run;
            end if;
            if v_org.kind <> v_app.organization_kind then
              v_outcome := 'refused'; v_code := 'kind_mismatch'; exit run;
            end if;
          end if;

          -- The same lock as the guard of the last member of an organization.
          perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('organization_members:' || v_org.id::text, 0));

          -- D-62 point 1: the administrator approves into a NEW organization only. Every existing
          -- organization is refused, also one without any member: a person joins an existing
          -- organization through its own curator (invitations, after the contest) or, as an
          -- emergency path, through the operator command ops:curator. The application stays
          -- pending and the administrator rejects it with an explanation. Nothing was written yet.
          if not v_created then
            v_outcome := 'refused'; v_code := 'organization_exists'; exit run;
          end if;

          insert into public.organization_members (organization_id, user_id)
          values (v_org.id, v_app.applicant_user_id);

          insert into public.operations_audit
            (operation, operator_label, subject_user_id, organization_id, outcome,
             before_state, after_state, reason)
          values (
            'grant_curator', 'panel administratora', v_app.applicant_user_id, v_org.id, 'applied',
            pg_catalog.jsonb_build_object('member', false),
            pg_catalog.jsonb_build_object(
              'member', true, 'organizationSlug', v_org.slug, 'organizationKind', v_org.kind,
              'organizationCreated', v_created, 'applicationId', v_app.id,
              'adminUserId', public.app_current_user_id()),
            'Wniosek o status kuratora');

          update public.curator_applications
             set status = 'approved', decided_at = pg_catalog.now(),
                 decided_by = public.app_current_user_id(), organization_id = v_org.id
           where id = v_app.id;
          v_result_org := v_org.id;
          exit run;
        end loop;

        perform pg_catalog.set_config('krajozbior.curator_panel_write', 'off', true);
        return query select v_outcome, v_code, v_result_org;
      end
      $$;
    `);

    // Take the role: names the person and the organization through an approved application
    // (the administrator never passes an account id). The application stays approved (history).
    this.addSql(`
      create function app_admin_revoke_curator(p_application_id uuid, p_reason text)
      returns table (outcome text, code text)
      language plpgsql security definer
      set search_path = ''
      as $$
      #variable_conflict use_column
      declare
        v_app public.curator_applications;
        v_rows integer;
        v_slug text;
        v_outcome text := 'applied';
        v_code text := null;
      begin
        perform public.app_require_live_admin();

        if p_reason is null
           or char_length(btrim(p_reason)) not between 1 and 400
           or p_reason ~ ${controlCharacters}
           or position('@' in p_reason) > 0 then
          raise exception 'invalid reason' using errcode = '22023';
        end if;

        perform pg_catalog.set_config('krajozbior.curator_panel_write', 'on', true);

        <<run>>
        loop
          v_app := (select a from public.curator_applications a where a.id = p_application_id for update);

          if v_app.id is null then
            v_outcome := 'refused'; v_code := 'not_found'; exit run;
          end if;
          -- Only the newest approved application of the pair (person, organization) may take the
          -- role; an older one, a pending or a rejected one has no member to remove.
          if v_app.status <> 'approved'
             or exists (select from public.curator_applications n
                         where n.applicant_user_id = v_app.applicant_user_id
                           and n.organization_id = v_app.organization_id
                           and n.status = 'approved'
                           and (n.decided_at, n.id) > (v_app.decided_at, v_app.id)) then
            v_outcome := 'refused'; v_code := 'not_member'; exit run;
          end if;

          perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('organization_members:' || v_app.organization_id::text, 0));

          delete from public.organization_members m
           where m.organization_id = v_app.organization_id
             and m.user_id = v_app.applicant_user_id;
          get diagnostics v_rows = row_count;

          if v_rows = 0 then
            v_outcome := 'refused'; v_code := 'not_member'; exit run;
          end if;

          -- The owner sees approved organizations only; for a suspended one the slug is null.
          v_slug := (select o.slug from public.organizations o where o.id = v_app.organization_id);

          insert into public.operations_audit
            (operation, operator_label, subject_user_id, organization_id, outcome,
             before_state, after_state, reason)
          values (
            'revoke_curator', 'panel administratora', v_app.applicant_user_id,
            v_app.organization_id, 'applied',
            pg_catalog.jsonb_build_object(
              'member', true, 'organizationSlug', v_slug, 'applicationId', v_app.id),
            pg_catalog.jsonb_build_object('member', false, 'adminUserId', public.app_current_user_id()),
            btrim(p_reason));
          exit run;
        end loop;

        perform pg_catalog.set_config('krajozbior.curator_panel_write', 'off', true);
        return query select v_outcome, v_code;
      end
      $$;
    `);

    for (const signature of [
      `app_admin_curator_applications(${listSignature})`,
      `app_admin_decide_curator_application(${decideSignature})`,
      `app_admin_revoke_curator(${revokeSignature})`,
    ]) {
      this.addSql(`revoke all on function ${signature} from public;`);
      this.addSql(`grant execute on function ${signature} to krajozbior_app;`);
    }
  }

  override async down(): Promise<void> {
    this.addSql(`drop function app_admin_revoke_curator(${revokeSignature});`);
    this.addSql(`drop function app_admin_decide_curator_application(${decideSignature});`);
    this.addSql(`drop function app_admin_curator_applications(${listSignature});`);
    this.addSql(`drop function app_require_live_admin();`);

    this.addSql(`drop policy operations_audit_panel_insert on operations_audit;`);
    this.addSql(`drop policy organization_members_panel_delete on organization_members;`);
    this.addSql(`drop policy organization_members_panel_insert on organization_members;`);
    this.addSql(`drop policy organizations_panel_insert on organizations;`);

    // The policies of the table go with it; no CASCADE.
    this.addSql(`drop table curator_applications;`);
    this.addSql(`drop function app_my_curator_application_count();`);
  }
}
