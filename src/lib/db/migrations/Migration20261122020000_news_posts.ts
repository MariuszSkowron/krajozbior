import { Migration } from "@mikro-orm/migrations";

// E7-R1 (spec E7, section 14.3): the table of news in the editorial version.
// Before the contest only the team publishes, from a file, through an operator
// function; there is no curator panel.
//
// 1. `news_posts` is the subset of the full table of the spec (section 5.1),
//    with the same names, types and constraints. It has no `created_by`, no
//    `hidden_reason`, no `hidden_at` and no `hidden` state.
// 2. Row security (enabled and forced). krajozbior_app and krajozbior_ops can
//    only read; krajozbior_app sees published news of approved organizations.
//    Nobody writes the table directly: the only writer is `ops_put_news`
//    (security definer, EXECUTE for krajozbior_ops only). The function runs as
//    krajozbior_owner, whose write policies hold only while the transaction
//    variable `krajozbior.news_write` is on AND the session user is
//    krajozbior_ops, so a login as the owner cannot write either.
// 3. `news_posts_publication` computes the dates, keeps the slug and sets
//    `content_updated_at` only for a change of the content (D-E7-9).
//    `news_posts_is_reference_cleared` recognizes the one write that must not
//    touch anything but `updated_at`: the foreign key action `on delete set
//    null (collection_id | place_id)` when a collection or a place is removed
//    (B1, D-E7-10). A test compares the columns of the table with that function.
// 4. `news_import` joins the operations of the audit CHECK and three refusal
//    codes join the error codes. `ops_put_news` does NOT write the audit: the
//    caller (krajozbior_ops) appends the entry with `writeAuditEntry` in the same
//    transaction, as for `ops_set_user_role` (B7). The target goes to
//    `before_state` / `after_state`; `details` stays empty, because
//    `operations_audit_details_check` allows it only for `catalog_import` and
//    `catalog_remove` and this migration does not change that (S24).
//
// After the contest (S25): the full version adds, without moving or changing
// existing rows, the columns `created_by`, `hidden_reason`, `hidden_at`, the
// index of the panel, the policies and grants of the curator, the guard of the
// transitions, `ops_hide_news` / `ops_restore_news`; it widens the CHECK of the
// state with `hidden` (drop and add the constraint) and replaces
// `news_posts_is_reference_cleared` (condition c' for `created_by`).
//
// Order: after Migration20261121150000_account_settings and the open E4
// migrations (the timestamp is later than all of them).

const slug = `'^[a-z0-9]+(-[a-z0-9]+)*$'`;
// Frozen copies of the limits of the domain (src/features/news/domain/limits.ts).
const kinds = `'new_place', 'info_change', 'event', 'guide', 'community'`;
const eventMinDate = `'2000-01-01'`;
const eventMaxDate = `'2100-12-31'`;
const maxNewsPerOrganization = 200;
// No control characters (Unicode Cc); the body may hold line feeds.
const noControl = `'[\\u0001-\\u001f\\u007f-\\u009f]'`;
const noControlButLineFeed = `'[\\u0001-\\u0009\\u000b-\\u001f\\u007f-\\u009f]'`;

const previousOperations = `'grant_curator', 'revoke_curator', 'set_organization_status', 'set_user_role', 'delete_account', 'catalog_import', 'catalog_remove'`;
const operations = `${previousOperations}, 'news_import'`;
const previousErrorCodes = `'user_not_found', 'organization_not_found', 'kind_mismatch', 'person_member_limit', 'organization_details_required', 'import_refused', 'import_failed'`;
const errorCodes = `${previousErrorCodes}, 'invalid_transition', 'stale_link', 'too_many_news', 'slug_taken'`;

const writeAllowed = `session_user = 'krajozbior_ops' and current_setting('krajozbior.news_write', true) = 'on'`;
const putNewsSignature = `uuid, uuid, text, text, text, text, text, uuid, uuid, date, date, text`;

export class Migration20261122020000_news_posts extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table news_posts (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references organizations (id),
        slug text not null unique check (slug ~ ${slug} and char_length(slug) <= 80),
        kind text not null check (kind in (${kinds})),
        title text not null check (
          char_length(title) between 5 and 120
          and title = normalize(title, NFC)
          and title !~ ${noControl}
        ),
        lead text not null check (
          char_length(lead) between 1 and 280
          and lead = normalize(lead, NFC)
          and lead !~ ${noControl}
        ),
        body text not null default '' check (
          char_length(body) <= 5000
          and body = normalize(body, NFC)
          and body !~ ${noControlButLineFeed}
        ),
        collection_id uuid null,
        place_id uuid null,
        event_starts_on date null,
        event_ends_on date null,
        status text not null default 'draft' check (status in ('draft', 'published', 'withdrawn')),
        first_published_at timestamptz null,
        published_at timestamptz null,
        withdrawn_at timestamptz null,
        content_updated_at timestamptz null,
        version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        foreign key (collection_id, organization_id)
          references collections (id, organization_id) on delete set null (collection_id),
        foreign key (place_id, organization_id)
          references places (id, organization_id) on delete set null (place_id),
        constraint news_posts_event_dates_check check (
          (kind = 'event') = (event_starts_on is not null)
          and (event_starts_on is null
               or event_starts_on between ${eventMinDate}::date and ${eventMaxDate}::date)
          and (event_ends_on is null
               or (event_starts_on is not null
                   and event_ends_on >= event_starts_on
                   and event_ends_on <= ${eventMaxDate}::date))
        ),
        constraint news_posts_published_dates_check check (
          status = 'draft' or (first_published_at is not null and published_at is not null)
        ),
        constraint news_posts_withdrawn_check check (
          (status = 'withdrawn') = (withdrawn_at is not null)
        )
      );
    `);

    this.addSql(`alter table news_posts enable row level security;`);
    this.addSql(`alter table news_posts force row level security;`);
    this.addSql(
      `revoke all on news_posts from public, krajozbior_app, krajozbior_auth, krajozbior_ops;`,
    );
    this.addSql(`grant select on news_posts to krajozbior_app, krajozbior_ops;`);

    this.addSql(
      `create index news_posts_status_published_at_idx on news_posts (status, published_at desc);`,
    );
    // Both are needed by the foreign key actions `set null` on a removal.
    this.addSql(`create index news_posts_collection_id_idx on news_posts (collection_id);`);
    this.addSql(`create index news_posts_place_id_idx on news_posts (place_id);`);

    this.addSql(`
      create policy news_posts_public_select on news_posts for select to krajozbior_app
        using (
          status = 'published'
          and exists (select from public.organizations o
                       where o.id = news_posts.organization_id and o.status = 'approved')
        );
    `);
    this.addSql(`
      create policy news_posts_ops_select on news_posts for select to krajozbior_ops
        using (true);
    `);
    // The function runs as the owner; these hold only inside it (see above).
    this.addSql(`
      create policy news_posts_function_select on news_posts for select to krajozbior_owner
        using (${writeAllowed});
    `);
    this.addSql(`
      create policy news_posts_function_insert on news_posts for insert to krajozbior_owner
        with check (${writeAllowed});
    `);
    this.addSql(`
      create policy news_posts_function_update on news_posts for update to krajozbior_owner
        using (${writeAllowed}) with check (${writeAllowed});
    `);

    // True for the write that only unpins a collection or a place: the state is
    // unchanged, each link stays or goes from set to empty, at least one link
    // changes, and every other column except `updated_at` is equal (B1).
    this.addSql(`
      create function news_posts_is_reference_cleared(o public.news_posts, n public.news_posts)
      returns boolean
      language sql immutable
      as $$
        select o.status = n.status
          and (o.collection_id is not distinct from n.collection_id
               or (o.collection_id is not null and n.collection_id is null))
          and (o.place_id is not distinct from n.place_id
               or (o.place_id is not null and n.place_id is null))
          and (o.collection_id is distinct from n.collection_id
               or o.place_id is distinct from n.place_id)
          and (o.id, o.organization_id, o.slug, o.kind, o.title, o.lead, o.body,
               o.event_starts_on, o.event_ends_on, o.first_published_at, o.published_at,
               o.withdrawn_at, o.content_updated_at, o.version, o.created_at)
              is not distinct from
              (n.id, n.organization_id, n.slug, n.kind, n.title, n.lead, n.body,
               n.event_starts_on, n.event_ends_on, n.first_published_at, n.published_at,
               n.withdrawn_at, n.content_updated_at, n.version, n.created_at)
      $$;
    `);

    // The only writer of the publication columns, on INSERT and UPDATE alike.
    this.addSql(`
      create function news_posts_publication() returns trigger
      language plpgsql
      set search_path = pg_catalog, public, pg_temp
      as $$
      begin
        if tg_op = 'INSERT' then
          if new.status = 'published' then
            new.first_published_at := now();
            new.published_at := now();
          else
            new.first_published_at := null;
            new.published_at := null;
          end if;
          new.withdrawn_at := null;
          new.content_updated_at := null;
          new.updated_at := now();
          return new;
        end if;

        -- Unpinning a collection or a place changes nothing but updated_at.
        if public.news_posts_is_reference_cleared(old, new) then
          new.updated_at := now();
          return new;
        end if;

        -- The address is fixed at the first publication (D-27).
        if not (old.first_published_at is null and new.status = 'published') then
          new.slug := old.slug;
        end if;

        if new.status = 'published' and old.status <> 'published' then
          new.first_published_at := coalesce(old.first_published_at, now());
          new.published_at := now();
          new.withdrawn_at := null;
        elsif new.status = 'withdrawn' and old.status <> 'withdrawn' then
          new.first_published_at := old.first_published_at;
          new.published_at := old.published_at;
          new.withdrawn_at := now();
        else
          new.first_published_at := old.first_published_at;
          new.published_at := old.published_at;
          new.withdrawn_at := old.withdrawn_at;
        end if;

        -- "Zaktualizowano": only a change of the content of a published item (D-E7-9).
        if old.status = 'published' and new.status = 'published'
           and (old.kind, old.title, old.lead, old.body, old.event_starts_on, old.event_ends_on)
               is distinct from
               (new.kind, new.title, new.lead, new.body, new.event_starts_on, new.event_ends_on)
        then
          new.content_updated_at := now();
        else
          new.content_updated_at := old.content_updated_at;
        end if;

        new.updated_at := now();
        return new;
      end
      $$;
    `);
    this.addSql(`revoke all on function news_posts_publication() from public;`);
    this.addSql(
      `revoke all on function news_posts_is_reference_cleared(public.news_posts, public.news_posts) from public;`,
    );
    this.addSql(`
      create trigger news_posts_publication before insert or update on news_posts
        for each row execute function news_posts_publication();
    `);

    // What the audit entry of the caller records about the target (S1): no title, no text.
    this.addSql(`
      create function news_posts_audit_state(p public.news_posts) returns jsonb
      language sql immutable
      set search_path = ''
      as $$
        select jsonb_build_object(
          'id', p.id, 'slug', p.slug, 'status', p.status,
          'organization_id', p.organization_id,
          'collection_id', p.collection_id, 'place_id', p.place_id)
      $$;
    `);
    this.addSql(`revoke all on function news_posts_audit_state(public.news_posts) from public;`);

    // The one writer. A refusal is an exception whose message is the code
    // (SQLSTATE P0001): invalid_transition, stale_link, too_many_news.
    // Row values are read with a scalar subquery (not SELECT INTO).
    this.addSql(`
      create function ops_put_news(
        p_id uuid, p_organization_id uuid, p_slug text, p_kind text, p_title text,
        p_lead text, p_body text, p_collection_id uuid, p_place_id uuid,
        p_event_starts_on date, p_event_ends_on date, p_status text,
        out put_result text, out put_before jsonb, out put_after jsonb
      )
      language plpgsql security definer
      set search_path = ''
      as $$
      declare
        v_old public.news_posts;
        v_new public.news_posts;
        v_count integer;
      begin
        -- A function clause \`set krajozbior.news_write\` would restore the value on exit,
        -- but the migration role may not set a custom parameter in it (not a superuser).
        -- So the switch is turned off again before every exit; an error rolls the
        -- transaction (or the savepoint of the caller) back. The switch is NOT a security
        -- boundary: krajozbior_ops may set this parameter itself. The boundary is: no
        -- write grants for ops and app, write policies only for the owner with
        -- session_user = 'krajozbior_ops', and no other owner function reachable by ops
        -- that writes to news_posts.
        perform set_config('krajozbior.news_write', 'on', true);

        v_old := (select n from public.news_posts n where n.id = p_id for update);

        if v_old.id is null then
          if p_status not in ('draft', 'published') then
            raise exception 'invalid_transition' using errcode = 'P0001';
          end if;

          perform pg_advisory_xact_lock(hashtextextended('news:' || p_organization_id::text, 0));
          v_count := (select count(*) from public.news_posts n where n.organization_id = p_organization_id);
          if v_count >= ${maxNewsPerOrganization} then
            raise exception 'too_many_news' using errcode = 'P0001';
          end if;

          begin
            insert into public.news_posts
              (id, organization_id, slug, kind, title, lead, body, collection_id, place_id,
               event_starts_on, event_ends_on, status)
            values
              (p_id, p_organization_id, p_slug, p_kind, p_title, p_lead, p_body, p_collection_id,
               p_place_id, p_event_starts_on, p_event_ends_on, p_status)
            returning * into v_new;
          exception when foreign_key_violation then
            raise exception 'stale_link' using errcode = 'P0001';
          end;

          put_result := 'created';
          put_before := null;
          put_after := public.news_posts_audit_state(v_new);
          perform set_config('krajozbior.news_write', 'off', true);
          return;
        end if;

        if p_organization_id <> v_old.organization_id then
          raise exception 'the organization of a news item cannot change' using errcode = '23514';
        end if;

        -- draft -> draft, draft -> published, published -> published,
        -- published -> withdrawn, withdrawn -> withdrawn, withdrawn -> published.
        if (v_old.status, p_status) not in (
          ('draft', 'draft'), ('draft', 'published'), ('published', 'published'),
          ('published', 'withdrawn'), ('withdrawn', 'withdrawn'), ('withdrawn', 'published')
        ) then
          raise exception 'invalid_transition' using errcode = 'P0001';
        end if;

        if (v_old.kind, v_old.title, v_old.lead, v_old.body, v_old.collection_id, v_old.place_id,
            v_old.event_starts_on, v_old.event_ends_on, v_old.status)
           is not distinct from
           (p_kind, p_title, p_lead, p_body, p_collection_id, p_place_id,
            p_event_starts_on, p_event_ends_on, p_status)
        then
          put_result := 'unchanged';
          put_before := public.news_posts_audit_state(v_old);
          put_after := put_before;
          perform set_config('krajozbior.news_write', 'off', true);
          return;
        end if;

        begin
          update public.news_posts
             set slug = coalesce(p_slug, v_old.slug), kind = p_kind, title = p_title,
                 lead = p_lead, body = p_body, collection_id = p_collection_id,
                 place_id = p_place_id, event_starts_on = p_event_starts_on,
                 event_ends_on = p_event_ends_on, status = p_status,
                 version = v_old.version + 1
           where id = p_id
          returning * into v_new;
        exception when foreign_key_violation then
          raise exception 'stale_link' using errcode = 'P0001';
        end;

        put_result := 'updated';
        put_before := public.news_posts_audit_state(v_old);
        put_after := public.news_posts_audit_state(v_new);
        perform set_config('krajozbior.news_write', 'off', true);
      end
      $$;
    `);
    this.addSql(`revoke all on function ops_put_news(${putNewsSignature}) from public;`);
    this.addSql(`grant execute on function ops_put_news(${putNewsSignature}) to krajozbior_ops;`);

    // The import names a collection by its address; krajozbior_ops gets no read of
    // \`collections\`, only this lookup: one uuid of a published collection of an
    // approved organization, nothing for a draft or an unknown address. The
    // condition is explicit in the body; the policy collections_owner_select of the
    // owner is only the second layer. Places have no
    // address; the file gives \`place_id\` directly.
    this.addSql(`
      create function ops_resolve_news_collection(p_slug text) returns uuid
      language sql stable security definer
      set search_path = ''
      as $$
        select c.id from public.collections c
         where c.slug = p_slug
           and c.status = 'published'
           and exists (select from public.organizations o
                        where o.id = c.organization_id and o.status = 'approved')
      $$;
    `);
    this.addSql(`revoke all on function ops_resolve_news_collection(text) from public;`);
    this.addSql(`grant execute on function ops_resolve_news_collection(text) to krajozbior_ops;`);

    // The audit: the operation and the refusal codes (krajozbior_ops already has
    // INSERT on the columns and the policy operations_audit_ops_insert).
    this.addSql(`alter table operations_audit drop constraint operations_audit_operation_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_operation_check
        check (operation in (${operations}));
    `);
    this.addSql(`alter table operations_audit drop constraint operations_audit_error_code_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_error_code_check
        check (error_code in (${errorCodes}));
    `);
  }

  override async down(): Promise<void> {
    // The append-only trigger blocks DELETE, so `news_import` entries stay and
    // the previous CHECKs are restored NOT VALID, as in Migration20261121140000.
    this.addSql(`alter table operations_audit drop constraint operations_audit_error_code_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_error_code_check
        check (error_code in (${previousErrorCodes})) not valid;
    `);
    this.addSql(`alter table operations_audit drop constraint operations_audit_operation_check;`);
    this.addSql(`
      alter table operations_audit add constraint operations_audit_operation_check
        check (operation in (${previousOperations})) not valid;
    `);

    this.addSql(`drop trigger news_posts_publication on news_posts;`);
    this.addSql(`drop function ops_resolve_news_collection(text);`);
    this.addSql(`drop function ops_put_news(${putNewsSignature});`);
    this.addSql(`drop function news_posts_audit_state(public.news_posts);`);
    this.addSql(`drop function news_posts_publication();`);
    this.addSql(
      `drop function news_posts_is_reference_cleared(public.news_posts, public.news_posts);`,
    );
    this.addSql(`drop table news_posts;`);
  }
}
