import { Migration } from "@mikro-orm/migrations";

// Organizations, their members and the operations audit (E1, PR1;
// docs/data-isolation.md sections 2 and 5).
//
// - `organizations` (public profile of an approved organization) and
//   `organization_members` (CUR): krajozbior_app only reads them. Nobody
//   becomes a curator through the web application: the operator command
//   (`npm run ops:curator`) writes them as krajozbior_owner, so every table
//   has narrow `to krajozbior_owner` policies (FORCE binds the owner too).
// - `operations_audit` (SYS): append-only record of every applied or rejected
//   operator command; a `noop` leaves no entry. No grant for any runtime role;
//   only the operator command (krajozbior_owner) reads and writes it.
// - `app_org_permission(organization_id)`: the one function every later policy
//   about organization content calls. security invoker, so it sees exactly what
//   the caller's own policies show: the caller's membership rows and the
//   organizations visible to the caller. It returns 'full_edit' for a member of
//   an approved organization and NULL otherwise (also without a user context).
// - Frozen CHECK lists (copies of ORGANIZATION_KINDS, ORGANIZATION_STATUSES and
//   the lists in src/lib/db/operations-audit.ts as of this migration; an
//   integration test compares them with the code).

const organizationKinds = `'municipality', 'pttk', 'local_tourism_org', 'regional_tourism_org', 'person', 'other'`;
const organizationStatuses = `'approved', 'suspended'`;
const operations = `'grant_curator', 'revoke_curator', 'set_organization_status'`;
const errorCodes = `'user_not_found', 'organization_not_found', 'kind_mismatch', 'person_member_limit', 'organization_details_required'`;
const slug = `'^[a-z0-9]+(-[a-z0-9]+)*$'`;

// Unicode category Cc (C0, DEL, C1): no line breaks or terminal escapes in the
// audit. NUL cannot occur in PostgreSQL text.
const controlCharacters = String.raw`'[\u0001-\u001f\u007f-\u009f]'`;

export class Migration20261117130000_organizations_ops_audit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table organizations (
        id uuid primary key default gen_random_uuid(),
        name text not null check (char_length(name) between 1 and 120),
        slug text not null unique check (slug ~ ${slug} and char_length(slug) <= 60),
        kind text not null check (kind in (${organizationKinds})),
        status text not null default 'approved' check (status in (${organizationStatuses})),
        created_at timestamptz not null default now()
      );
    `);

    this.addSql(`
      create table organization_members (
        organization_id uuid not null references organizations (id),
        user_id uuid not null references auth.users (id) on delete cascade,
        created_at timestamptz not null default now(),
        primary key (organization_id, user_id)
      );
    `);
    // The "own rows" policy and app_org_permission filter by user_id.
    this.addSql(`create index organization_members_user_id_idx on organization_members (user_id);`);

    // No foreign keys: the history outlives an account and an organization, and
    // a rejected operation may name a user or organization that does not exist.
    this.addSql(`
      create table operations_audit (
        id uuid primary key default gen_random_uuid(),
        occurred_at timestamptz not null default now(),
        operation text not null check (operation in (${operations})),
        operator_label text not null check (
          char_length(operator_label) between 1 and 80 and operator_label !~ ${controlCharacters}),
        subject_user_id uuid null,
        organization_id uuid null,
        outcome text not null check (outcome in ('applied', 'rejected')),
        before_state jsonb null check (before_state is null or jsonb_typeof(before_state) = 'object'),
        after_state jsonb null check (after_state is null or jsonb_typeof(after_state) = 'object'),
        reason text not null check (
          char_length(reason) between 1 and 400 and reason !~ ${controlCharacters}),
        error_code text null check (error_code in (${errorCodes})),
        constraint operations_audit_outcome_error_code_check
          check ((outcome = 'applied') = (error_code is null))
      );
    `);

    // Append-only for every role, the owner included (TRUNCATE is not covered
    // by row policies, so it gets its own statement trigger).
    this.addSql(`
      create function operations_audit_append_only() returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        raise exception 'operations_audit is append-only' using errcode = '55000';
      end
      $$;
    `);
    this.addSql(`revoke all on function operations_audit_append_only() from public;`);
    this.addSql(`
      create trigger operations_audit_append_only before update or delete on operations_audit
        for each row execute function operations_audit_append_only();
    `);
    this.addSql(`
      create trigger operations_audit_no_truncate before truncate on operations_audit
        for each statement execute function operations_audit_append_only();
    `);

    for (const table of ["organizations", "organization_members", "operations_audit"]) {
      this.addSql(`alter table ${table} enable row level security;`);
      // FORCE: the table owner is bound by the policies too.
      this.addSql(`alter table ${table} force row level security;`);
      this.addSql(
        `revoke all on ${table} from public, krajozbior_app, krajozbior_auth, krajozbior_ops;`,
      );
    }

    // krajozbior_app: read only.
    this.addSql(`grant select on organizations, organization_members to krajozbior_app;`);
    this.addSql(`
      create policy organizations_public_select on organizations for select to krajozbior_app
        using (
          status = 'approved'
          or exists (
            select from organization_members m
             where m.organization_id = organizations.id
               and m.user_id = (select app_current_user_id())
          )
        );
    `);
    this.addSql(`
      create policy organization_members_own_select on organization_members
        for select to krajozbior_app
        using (user_id = (select app_current_user_id()));
    `);

    // krajozbior_owner: the operator command (D-T7). It never deletes an
    // organization; a revoked membership row is deleted.
    this.addSql(`
      create policy organizations_operator_select on organizations
        for select to krajozbior_owner using (true);
    `);
    this.addSql(`
      create policy organizations_operator_insert on organizations
        for insert to krajozbior_owner with check (true);
    `);
    this.addSql(`
      create policy organizations_operator_update on organizations
        for update to krajozbior_owner using (true) with check (true);
    `);
    this.addSql(`
      create policy organization_members_operator_select on organization_members
        for select to krajozbior_owner using (true);
    `);
    this.addSql(`
      create policy organization_members_operator_insert on organization_members
        for insert to krajozbior_owner with check (true);
    `);
    this.addSql(`
      create policy organization_members_operator_delete on organization_members
        for delete to krajozbior_owner using (true);
    `);
    this.addSql(`
      create policy operations_audit_operator_select on operations_audit
        for select to krajozbior_owner using (true);
    `);
    this.addSql(`
      create policy operations_audit_operator_insert on operations_audit
        for insert to krajozbior_owner with check (true);
    `);

    this.addSql(`
      create function app_org_permission(p_organization_id uuid) returns text
      language sql stable security invoker
      set search_path = pg_catalog, public, pg_temp
      as $$
        select case when exists (
          select
            from public.organization_members m
            join public.organizations o on o.id = m.organization_id
           where m.organization_id = p_organization_id
             and m.user_id = public.app_current_user_id()
             and o.status = 'approved'
        ) then 'full_edit' end
      $$;
    `);
    this.addSql(`revoke all on function app_org_permission(uuid) from public;`);
    this.addSql(`grant execute on function app_org_permission(uuid) to krajozbior_app;`);
  }

  override async down(): Promise<void> {
    // Tables tied by policies go in one statement, without CASCADE.
    this.addSql(`drop table operations_audit, organization_members, organizations;`);
    this.addSql(`drop function app_org_permission(uuid);`);
    this.addSql(`drop function operations_audit_append_only();`);
  }
}
