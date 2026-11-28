import { Migration } from "@mikro-orm/migrations";

// P4b, PR A (spec "Kolejka zgłoszeń kuratora", sections 5.1 and 5.2): reports of a
// problem with a place, as a slice of the full table of E5. Class CUR
// (docs/data-isolation.md): the author and the curators of the organization of the
// place.
//
// 1. `place_reports` is created together with its row security (enabled and
//    forced). krajozbior_auth and krajozbior_ops have no privilege at all.
// 2. krajozbior_app (the author): SELECT only on the columns listed below, WITHOUT
//    `decided_by` (the identifier of the deciding curator is personal data of the
//    curator); INSERT only on `place_id, category, message`; no UPDATE, no DELETE.
//    A restrictive INSERT policy demands a place in a published collection of an
//    approved organization that the author does not run.
// 3. A curator never touches the table directly: three functions (security
//    definer, owner krajozbior_owner, empty search_path, EXECUTE only for
//    krajozbior_app) count, list and decide. They run as the owner, whose policies
//    on `place_reports` hold only for a member of the organization of the row.
//    The label of the author ("Anna K.") needs one more narrow policy of the owner
//    on `profiles` (`profiles_owner_report_author_select`).
// 4. The trigger `place_reports_fill` sets the organization and the name of the place
//    from the place itself, so a client cannot choose the addressee.
//
// PR B adds, in a separate migration, the limits and the clean-up on the deletion of
// the account of the author. Frozen copies of lists: src/features/reports/domain.

const categories = `'missing', 'closed', 'private_or_unsafe', 'wrong_location', 'wrong_info', 'other'`;
const rejectReasons = `'duplicate', 'not_accurate', 'not_verifiable', 'out_of_scope', 'abuse', 'other'`;
// Only a line feed is allowed among the control characters; zero-width characters and
// the controls of the text direction are refused as well, so the text cannot be made
// to look different to the curator (spec M1, N-C).
const reportText = `'[\\u0001-\\u0009\\u000b-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069]'`;

const authorColumns = `id, kind, organization_id, place_id, place_name_snapshot, author_id, category, message, status, reject_reason, decision_note, decided_at, created_at, version`;

const countsSignature = `uuid`;
const queueSignature = `uuid, text, integer`;
const decideSignature = `uuid, text, text, text, integer`;

export class Migration20261128010000_place_reports extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table place_reports (
        id uuid primary key default gen_random_uuid(),
        kind text not null default 'problem' check (kind = 'problem'),
        organization_id uuid not null references organizations (id),
        place_id uuid null references places (id) on delete set null,
        place_name_snapshot text not null,
        author_id uuid null default app_current_user_id() references auth.users (id) on delete set null,
        category text not null check (category in (${categories})),
        message text not null default '' check (
          char_length(message) <= 1000 and message !~ ${reportText}
        ),
        status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
        reject_reason text null check (reject_reason in (${rejectReasons})),
        decision_note text null check (
          char_length(decision_note) <= 500 and decision_note !~ ${reportText}
        ),
        decided_by uuid null references auth.users (id) on delete set null,
        decided_at timestamptz null,
        created_at timestamptz not null default now(),
        version integer not null default 1,
        constraint place_reports_open_text_check check (
          status <> 'open'
          or category not in ('other', 'wrong_info')
          or char_length(btrim(message)) > 0
        ),
        constraint place_reports_decided_at_check check ((status = 'open') = (decided_at is null)),
        constraint place_reports_reject_state_check check (
          (status = 'rejected') = (reject_reason is not null)
        ),
        constraint place_reports_open_note_check check (status <> 'open' or decision_note is null)
      );
    `);

    // Each foreign key that a removal sets to null needs its own index.
    this.addSql(`
      create index place_reports_org_open_idx on place_reports (organization_id, created_at)
        where status = 'open';
    `);
    this.addSql(`
      create index place_reports_org_decided_idx on place_reports (organization_id, decided_at desc)
        where status <> 'open';
    `);
    this.addSql(
      `create index place_reports_author_created_idx on place_reports (author_id, created_at desc);`,
    );
    this.addSql(`create index place_reports_place_id_idx on place_reports (place_id);`);
    this.addSql(`create index place_reports_decided_by_idx on place_reports (decided_by);`);
    this.addSql(`
      create unique index place_reports_one_open_idx on place_reports (author_id, place_id, category)
        where status = 'open';
    `);

    this.addSql(`alter table place_reports enable row level security;`);
    // FORCE: the table owner is bound by the policies too.
    this.addSql(`alter table place_reports force row level security;`);
    this.addSql(
      `revoke all on place_reports from public, krajozbior_app, krajozbior_auth, krajozbior_ops;`,
    );
    // Column grants: the author never reads `decided_by`; the organization and the
    // author are set by the database (the default and the trigger).
    this.addSql(`grant select (${authorColumns}) on place_reports to krajozbior_app;`);
    this.addSql(`grant insert (place_id, category, message) on place_reports to krajozbior_app;`);

    this.addSql(`
      create policy place_reports_author_select on place_reports for select to krajozbior_app
        using (author_id = (select app_current_user_id()));
    `);
    this.addSql(`
      create policy place_reports_author_insert on place_reports for insert to krajozbior_app
        with check (author_id = (select app_current_user_id()));
    `);
    // A foreign key skips row security, so the target is an explicit query: a place of
    // a published collection of an approved organization, and not of the author's own
    // organization (a member corrects the place in the editor instead).
    this.addSql(`
      create policy place_reports_target_insert on place_reports
        as restrictive for insert to krajozbior_app
        with check (
          place_id is not null
          and exists (
            select
              from public.places p
              join public.collection_places cp on cp.place_id = p.id
              join public.collections pc on pc.id = cp.collection_id
              join public.organizations po on po.id = pc.organization_id
             where p.id = place_reports.place_id
               and pc.status = 'published'
               and po.status = 'approved'
               and (select public.app_org_permission(p.organization_id)) is null
          )
        );
    `);

    // The owner runs the functions of the curator: only rows of an organization of
    // which the caller is a member (D-16). The condition is also in each function.
    this.addSql(`
      create policy place_reports_owner_select on place_reports for select to krajozbior_owner
        using ((select public.app_org_permission(organization_id)) is not null);
    `);
    this.addSql(`
      create policy place_reports_owner_update on place_reports for update to krajozbior_owner
        using ((select public.app_org_permission(organization_id)) is not null)
        with check ((select public.app_org_permission(organization_id)) is not null);
    `);
    // The widest policy of the owner of this change: the label of the author. The
    // function reads two columns only (first_name, family_initial); a test lists the
    // functions of the owner that read this table.
    this.addSql(`
      create policy profiles_owner_report_author_select on public.profiles
        for select to krajozbior_owner
        using (
          exists (
            select
              from public.place_reports r
             where r.author_id = profiles.user_id
               and (select public.app_org_permission(r.organization_id)) is not null
          )
        );
    `);

    // The organization and the name of the place come from the place (the author sees
    // it by the public policy); whatever the client sent is overwritten.
    this.addSql(`
      create function place_reports_fill() returns trigger
      language plpgsql
      set search_path = pg_catalog, public, pg_temp
      as $$
      declare
        v_organization uuid;
        v_name text;
      begin
        v_organization := (select p.organization_id from public.places p where p.id = new.place_id);
        v_name := (select p.name from public.places p where p.id = new.place_id);
        new.organization_id := v_organization;
        new.place_name_snapshot := coalesce(v_name, '');
        new.status := 'open';
        new.version := 1;
        new.reject_reason := null;
        new.decision_note := null;
        new.decided_by := null;
        new.decided_at := null;
        return new;
      end
      $$;
    `);
    this.addSql(`revoke all on function place_reports_fill() from public;`);
    this.addSql(`
      create trigger place_reports_fill before insert on place_reports
        for each row execute function place_reports_fill();
    `);

    // Functions of the curator. A refusal is an exception whose message is the code
    // (SQLSTATE P0001). The caller must be signed in; a missing or foreign
    // organization gives an empty answer (counts, queue) or `not_found` (decision),
    // the same for "does not exist" and "not yours".
    this.addSql(`
      create function app_report_counts(p_organization_id uuid) returns integer
      language plpgsql stable security definer
      set search_path = ''
      as $$
      begin
        if public.app_current_user_id() is null then
          raise exception 'forbidden' using errcode = 'P0001', constraint = 'forbidden';
        end if;

        if public.app_org_permission(p_organization_id) is null then
          return 0;
        end if;

        return (
          select count(*)::integer
            from public.place_reports r
           where r.organization_id = p_organization_id and r.status = 'open'
        );
      end
      $$;
    `);

    this.addSql(`
      create function app_report_queue(p_organization_id uuid, p_state text, p_limit integer)
      returns table (
        id uuid, category text, message text, status text, reject_reason text,
        decision_note text, created_at timestamptz, decided_at timestamptz, version integer,
        place_id uuid, place_name text, place_deleted boolean, author_label text,
        author_gone boolean
      )
      language plpgsql stable security definer
      set search_path = ''
      as $$
      declare
        v_max integer;
        v_limit integer;
      begin
        if public.app_current_user_id() is null then
          raise exception 'forbidden' using errcode = 'P0001', constraint = 'forbidden';
        end if;

        if p_state is null or p_state not in ('open', 'decided') then
          raise exception 'invalid_argument' using errcode = 'P0001', constraint = 'invalid_argument';
        end if;

        if public.app_org_permission(p_organization_id) is null then
          return;
        end if;

        v_max := case when p_state = 'open' then 200 else 50 end;
        v_limit := least(greatest(coalesce(p_limit, v_max), 1), v_max);

        if p_state = 'open' then
          return query
            select r.id, r.category, r.message, r.status, r.reject_reason, r.decision_note,
                   r.created_at, r.decided_at, r.version, r.place_id, r.place_name_snapshot,
                   r.place_id is null,
                   case
                     when r.author_id is null then 'Konto usunięte'
                     when pr.first_name is null then 'Odkrywca'
                     when pr.family_initial is null then pr.first_name
                     else pr.first_name || ' ' || pr.family_initial || '.'
                   end,
                   r.author_id is null
              from public.place_reports r
              left join public.profiles pr on pr.user_id = r.author_id
             where r.organization_id = p_organization_id and r.status = 'open'
             order by r.created_at, r.id
             limit v_limit;
        else
          return query
            select r.id, r.category, r.message, r.status, r.reject_reason, r.decision_note,
                   r.created_at, r.decided_at, r.version, r.place_id, r.place_name_snapshot,
                   r.place_id is null,
                   case
                     when r.author_id is null then 'Konto usunięte'
                     when pr.first_name is null then 'Odkrywca'
                     when pr.family_initial is null then pr.first_name
                     else pr.first_name || ' ' || pr.family_initial || '.'
                   end,
                   r.author_id is null
              from public.place_reports r
              left join public.profiles pr on pr.user_id = r.author_id
             where r.organization_id = p_organization_id and r.status <> 'open'
             order by r.decided_at desc, r.id
             limit v_limit;
        end if;
      end
      $$;
    `);

    // accept / reject (from open) and undo (from a decided state). Returns the new
    // version. The organization is the one of the report, not a parameter. The row
    // is read FOR UPDATE before the version is compared (two curators at once).
    // Row values are read with a scalar subquery (not SELECT INTO).
    this.addSql(`
      create function app_decide_report(
        p_report_id uuid, p_action text, p_reason text, p_note text, p_version integer
      ) returns integer
      language plpgsql security definer
      set search_path = ''
      as $$
      declare
        v_report public.place_reports;
        v_actor uuid := public.app_current_user_id();
        v_version integer;
      begin
        if v_actor is null then
          raise exception 'forbidden' using errcode = 'P0001', constraint = 'forbidden';
        end if;

        if p_action is null or p_action not in ('accept', 'reject', 'undo') then
          raise exception 'invalid_argument' using errcode = 'P0001', constraint = 'invalid_argument';
        end if;

        v_report := (select r from public.place_reports r where r.id = p_report_id for update);

        if v_report.id is null
           or public.app_org_permission(v_report.organization_id) is null then
          raise exception 'not_found' using errcode = 'P0001', constraint = 'not_found';
        end if;

        if v_report.author_id = v_actor then
          raise exception 'own_report' using errcode = 'P0001', constraint = 'own_report';
        end if;

        if p_version is distinct from v_report.version then
          raise exception 'stale_version' using errcode = 'P0001', constraint = 'stale_version';
        end if;

        if p_action = 'undo' then
          if v_report.status = 'open' then
            raise exception 'invalid_state' using errcode = 'P0001', constraint = 'invalid_state';
          end if;

          if v_report.author_id is null then
            raise exception 'author_gone' using errcode = 'P0001', constraint = 'author_gone';
          end if;

          update public.place_reports
             set status = 'open', reject_reason = null, decision_note = null,
                 decided_by = null, decided_at = null, version = v_report.version + 1
           where id = v_report.id
          returning version into v_version;

          return v_version;
        end if;

        if v_report.status <> 'open' then
          raise exception 'invalid_state' using errcode = 'P0001', constraint = 'invalid_state';
        end if;

        if p_action = 'reject' and (p_reason is null or p_reason not in (${rejectReasons})) then
          raise exception 'invalid_argument' using errcode = 'P0001', constraint = 'invalid_argument';
        end if;

        update public.place_reports
           set status = case when p_action = 'accept' then 'accepted' else 'rejected' end,
               reject_reason = case when p_action = 'reject' then p_reason end,
               decision_note = nullif(btrim(p_note), ''),
               decided_by = v_actor, decided_at = now(), version = v_report.version + 1
         where id = v_report.id
        returning version into v_version;

        return v_version;
      end
      $$;
    `);

    this.addSql(`revoke all on function app_report_counts(${countsSignature}) from public;`);
    this.addSql(`revoke all on function app_report_queue(${queueSignature}) from public;`);
    this.addSql(`revoke all on function app_decide_report(${decideSignature}) from public;`);
    this.addSql(
      `grant execute on function app_report_counts(${countsSignature}) to krajozbior_app;`,
    );
    this.addSql(`grant execute on function app_report_queue(${queueSignature}) to krajozbior_app;`);
    this.addSql(
      `grant execute on function app_decide_report(${decideSignature}) to krajozbior_app;`,
    );
  }

  override async down(): Promise<void> {
    // The policy on `profiles` refers to `place_reports`, so it goes first. The table
    // takes its own policies and trigger with it; no CASCADE.
    this.addSql(`drop policy profiles_owner_report_author_select on public.profiles;`);
    this.addSql(`drop function app_decide_report(${decideSignature});`);
    this.addSql(`drop function app_report_queue(${queueSignature});`);
    this.addSql(`drop function app_report_counts(${countsSignature});`);
    this.addSql(`drop table place_reports;`);
    this.addSql(`drop function place_reports_fill();`);
  }
}
