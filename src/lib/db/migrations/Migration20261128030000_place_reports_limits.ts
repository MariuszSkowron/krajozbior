import { Migration } from "@mikro-orm/migrations";

// P4b, PR B (spec "Kolejka zgłoszeń kuratora", sections 5.1 and 7): what the form of the
// explorer needs on top of the queue of PR A.
//
// 1. Limits of a new report, enforced by the database (the numbers are repeated in
//    src/features/reports/domain/limits.ts, a test compares them):
//    - `place_reports_limits` (invoker, the author sees their own rows): at most 10 reports
//      in 24 hours (decided ones count) and 50 open ones per author;
//    - `place_reports_place_limit` (definer, owner): at most 20 open reports per place from
//      all authors. The author does not see other people's rows, so the function counts as
//      the owner (a narrow policy `status = 'open'`) and returns nothing but a refusal.
//    Both take an advisory lock first (the author, then the place: always in this order, so
//    there is no deadlock), so two parallel sends cannot both pass at the count of nine.
//    BEFORE triggers run in the order of their names: fill < limits < place_limit.
// 2. The deletion of the account of the author (the foreign key sets `author_id` to null):
//    a decided report loses its text (`place_reports_clear_on_author_delete`), an open one
//    is removed (`place_reports_purge_orphaned`, definer, narrow policies of the owner).
//    The text is cleared only for a decided report: clearing an open one would break the
//    CHECK of the text and block the deletion of the account (verification N-A).
// 3. `app_decide_report`: an undo of a decision is refused with `duplicate_open` when the
//    author has already sent a new open report of the same category for the same place
//    (the unique index would fail the update, which was a 503 before).

const rejectReasons = `'duplicate', 'not_accurate', 'not_verifiable', 'out_of_scope', 'abuse', 'other'`;

// The function of PR A, with (or without, for `down`) the check of the duplicate on undo.
function decideReportFunction(duplicateCheck: boolean): string {
  const duplicate = duplicateCheck
    ? `
          if v_report.place_id is not null and exists (
            select
              from public.place_reports o
             where o.author_id = v_report.author_id
               and o.place_id = v_report.place_id
               and o.category = v_report.category
               and o.status = 'open'
               and o.id <> v_report.id
          ) then
            raise exception 'duplicate_open' using errcode = 'P0001', constraint = 'duplicate_open';
          end if;
`
    : "";

  return `
      create or replace function app_decide_report(
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
${duplicate}
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
    `;
}

export class Migration20261128030000_place_reports_limits extends Migration {
  override async up(): Promise<void> {
    // Limits per author. The author reads their own rows by the policy of PR A.
    this.addSql(`
      create function place_reports_limits() returns trigger
      language plpgsql
      set search_path = pg_catalog, public, pg_temp
      as $$
      declare
        v_recent integer;
        v_open integer;
      begin
        if new.author_id is null then
          return new;
        end if;

        perform pg_advisory_xact_lock(hashtextextended('place_reports:author:' || new.author_id::text, 0));

        v_recent := (
          select count(*)::integer
            from public.place_reports r
           where r.author_id = new.author_id and r.created_at > now() - interval '24 hours'
        );

        if v_recent >= 10 then
          raise exception 'report_daily_limit' using errcode = 'P0001', constraint = 'report_daily_limit';
        end if;

        v_open := (
          select count(*)::integer
            from public.place_reports r
           where r.author_id = new.author_id and r.status = 'open'
        );

        if v_open >= 50 then
          raise exception 'report_open_limit' using errcode = 'P0001', constraint = 'report_open_limit';
        end if;

        return new;
      end
      $$;
    `);
    this.addSql(`revoke all on function place_reports_limits() from public;`);
    this.addSql(`
      create trigger place_reports_limits before insert on place_reports
        for each row execute function place_reports_limits();
    `);

    // Limit per place, from all authors. Runs as the owner: it counts rows the author cannot
    // see and says nothing but the refusal.
    this.addSql(`
      create function place_reports_place_limit() returns trigger
      language plpgsql security definer
      set search_path = ''
      as $$
      declare
        v_open integer;
      begin
        if new.place_id is null then
          return new;
        end if;

        perform pg_advisory_xact_lock(hashtextextended('place_reports:place:' || new.place_id::text, 0));

        v_open := (
          select count(*)::integer
            from public.place_reports r
           where r.place_id = new.place_id and r.status = 'open'
        );

        if v_open >= 20 then
          raise exception 'report_place_limit' using errcode = 'P0001', constraint = 'report_place_limit';
        end if;

        return new;
      end
      $$;
    `);
    this.addSql(`revoke all on function place_reports_place_limit() from public;`);
    this.addSql(`
      create trigger place_reports_place_limit before insert on place_reports
        for each row execute function place_reports_place_limit();
    `);
    this.addSql(`
      create policy place_reports_owner_open_select on place_reports
        for select to krajozbior_owner
        using (status = 'open');
    `);

    // The deletion of the account of the author: the foreign key sets `author_id` to null.
    this.addSql(`
      create function place_reports_clear_on_author_delete() returns trigger
      language plpgsql
      set search_path = pg_catalog, public, pg_temp
      as $$
      begin
        if old.author_id is not null and new.author_id is null and new.status <> 'open' then
          new.message := '';
        end if;

        return new;
      end
      $$;
    `);
    this.addSql(`revoke all on function place_reports_clear_on_author_delete() from public;`);
    this.addSql(`
      create trigger place_reports_clear_on_author_delete before update of author_id on place_reports
        for each row execute function place_reports_clear_on_author_delete();
    `);

    this.addSql(`
      create function place_reports_purge_orphaned() returns trigger
      language plpgsql security definer
      set search_path = ''
      as $$
      begin
        if old.author_id is not null and new.author_id is null and new.status = 'open' then
          delete from public.place_reports where id = new.id;
        end if;

        return null;
      end
      $$;
    `);
    this.addSql(`revoke all on function place_reports_purge_orphaned() from public;`);
    this.addSql(`
      create trigger place_reports_purge_orphaned after update of author_id on place_reports
        for each row execute function place_reports_purge_orphaned();
    `);
    this.addSql(`
      create policy place_reports_owner_orphan_select on place_reports
        for select to krajozbior_owner
        using (author_id is null and status = 'open');
    `);
    this.addSql(`
      create policy place_reports_owner_orphan_delete on place_reports
        for delete to krajozbior_owner
        using (author_id is null and status = 'open');
    `);

    // The same function as in PR A, with the check of the duplicate on undo.
    this.addSql(decideReportFunction(true));
  }

  override async down(): Promise<void> {
    this.addSql(decideReportFunction(false));
    this.addSql(`drop policy place_reports_owner_orphan_delete on place_reports;`);
    this.addSql(`drop policy place_reports_owner_orphan_select on place_reports;`);
    this.addSql(`drop trigger place_reports_purge_orphaned on place_reports;`);
    this.addSql(`drop function place_reports_purge_orphaned();`);
    this.addSql(`drop trigger place_reports_clear_on_author_delete on place_reports;`);
    this.addSql(`drop function place_reports_clear_on_author_delete();`);
    this.addSql(`drop policy place_reports_owner_open_select on place_reports;`);
    this.addSql(`drop trigger place_reports_place_limit on place_reports;`);
    this.addSql(`drop function place_reports_place_limit();`);
    this.addSql(`drop trigger place_reports_limits on place_reports;`);
    this.addSql(`drop function place_reports_limits();`);
  }
}
