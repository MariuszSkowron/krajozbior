import { Migration } from "@mikro-orm/migrations";

// Catalog of collections and places (E1, PR2; docs/data-isolation.md sections 2
// and 5; spec D-T2, D-T5, D-T8, table 5.1).
//
// - Content of a curator is written by krajozbior_app in the curator's user
//   context, directly through row policies and column grants (deliberate
//   departure from "only through functions", accepted as D-16). Every write
//   policy calls app_org_permission(organization_id) on the row's own column.
// - The policy graph is one-way and has no cycle:
//   places -> collection_places -> collections -> organizations /
//   organization_members. No policy points "up".
// - `published_at` and `first_published_at` have no UPDATE grant (nor INSERT
//   grant): the one trigger zz_collections_publication computes both from OLD
//   and NEW, whatever a statement says. It is named `zz_...` so it runs last
//   among BEFORE triggers of the table; no other BEFORE trigger touches the
//   publication columns. A new collection is always a draft (INSERT policy).
//   Restoring a dump with `--data-only` needs `--disable-triggers` (otherwise
//   the INSERT branch stamps every published collection with the restore time).
// - A published collection that was ever published cannot be deleted
//   (DELETE policy needs first_published_at is null): saved collections of
//   explorers (a later migration) keep pointing at it.
// - Frozen CHECK lists (copies of REGIONS and COLLECTION_STATUSES in
//   src/features/catalog/domain; an integration test compares them).

const regions = [
  "dolnoslaskie",
  "kujawsko_pomorskie",
  "lubelskie",
  "lubuskie",
  "lodzkie",
  "malopolskie",
  "mazowieckie",
  "opolskie",
  "podkarpackie",
  "podlaskie",
  "pomorskie",
  "slaskie",
  "swietokrzyskie",
  "warminsko_mazurskie",
  "wielkopolskie",
  "zachodniopomorskie",
]
  .map((region) => `'${region}'`)
  .join(", ");
const collectionStatuses = `'draft', 'published'`;
const slug = `'^[a-z0-9]+(-[a-z0-9]+)*$'`;

// "Publicly visible" collection: published, owned by an approved organization.
// Spelled as an explicit query (never "visible through the SELECT policy"),
// because the policies of a curator show their own drafts too.
const publicCollection = (collection: string) => `
  exists (
    select
      from public.collections pc
      join public.organizations po on po.id = pc.organization_id
     where pc.id = ${collection}
       and pc.status = 'published'
       and po.status = 'approved'
  )`;

export class Migration20261117140000_catalog extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table collections (
        id uuid primary key default gen_random_uuid(),
        slug text not null unique check (slug ~ ${slug} and char_length(slug) <= 80),
        organization_id uuid not null references organizations (id),
        title text not null check (char_length(title) between 1 and 120),
        summary text not null default '' check (char_length(summary) <= 280),
        region text not null check (region in (${regions})),
        status text not null default 'draft' check (status in (${collectionStatuses})),
        published_at timestamptz null,
        first_published_at timestamptz null,
        version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (id, organization_id),
        constraint collections_published_dates_check
          check (status = 'draft' or (first_published_at is not null and published_at is not null))
      );
    `);
    this.addSql(`create index collections_organization_id_idx on collections (organization_id);`);

    this.addSql(`
      create table places (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references organizations (id),
        name text not null check (char_length(name) between 1 and 120),
        description text not null default '' check (char_length(description) <= 4000),
        address text not null default '' check (char_length(address) <= 200),
        access_info text not null default '' check (char_length(access_info) <= 1000),
        latitude double precision not null check (latitude between -90 and 90),
        longitude double precision not null check (longitude between -180 and 180),
        visit_radius_m integer not null default 200 check (visit_radius_m between 50 and 2000),
        version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (id, organization_id)
      );
    `);
    this.addSql(`create index places_organization_id_idx on places (organization_id);`);

    // Composite keys keep a link inside one organization: the collection and the
    // place must both belong to \`organization_id\` (D-15), so the write policy
    // needs no read of \`places\`. A draft that was never published takes its
    // links with it; a published one cannot be deleted at all.
    this.addSql(`
      create table collection_places (
        collection_id uuid not null,
        place_id uuid not null,
        organization_id uuid not null,
        position integer not null check (position >= 1),
        added_at timestamptz not null default now(),
        primary key (collection_id, place_id),
        unique (collection_id, position) deferrable initially deferred,
        foreign key (collection_id, organization_id)
          references collections (id, organization_id) on delete cascade,
        foreign key (place_id, organization_id)
          references places (id, organization_id)
      );
    `);
    this.addSql(
      `create index collection_places_organization_id_idx on collection_places (organization_id);`,
    );
    // The SELECT policy of places looks links up by place.
    this.addSql(`create index collection_places_place_id_idx on collection_places (place_id);`);

    // The only writer of the publication columns, on INSERT and UPDATE alike.
    this.addSql(`
      create function collections_publication() returns trigger
      language plpgsql
      set search_path = pg_catalog, public, pg_temp
      as $$
      declare
        v_old_status text;
        v_old_first timestamptz;
        v_old_published timestamptz;
      begin
        if tg_op = 'UPDATE' then
          v_old_status := old.status;
          v_old_first := old.first_published_at;
          v_old_published := old.published_at;
        end if;

        if new.status = 'published' and v_old_status is distinct from 'published' then
          new.first_published_at := coalesce(v_old_first, now());
          new.published_at := now();
        else
          new.first_published_at := v_old_first;
          new.published_at := v_old_published;
        end if;

        return new;
      end
      $$;
    `);
    this.addSql(`revoke all on function collections_publication() from public;`);
    this.addSql(`
      create trigger zz_collections_publication before insert or update on collections
        for each row execute function collections_publication();
    `);

    for (const table of ["collections", "places", "collection_places"]) {
      this.addSql(`alter table ${table} enable row level security;`);
      // FORCE: the table owner is bound by the policies too.
      this.addSql(`alter table ${table} force row level security;`);
      this.addSql(
        `revoke all on ${table} from public, krajozbior_app, krajozbior_auth, krajozbior_ops;`,
      );
    }

    // No grant on first_published_at, published_at, id, slug-after-insert,
    // organization_id-after-insert: they are immutable for krajozbior_app.
    this.addSql(`grant select on collections, places, collection_places to krajozbior_app;`);
    this.addSql(
      `grant insert (slug, organization_id, title, summary, region, status) on collections to krajozbior_app;`,
    );
    this.addSql(
      `grant update (title, summary, region, status, version, updated_at) on collections to krajozbior_app;`,
    );
    this.addSql(`grant delete on collections to krajozbior_app;`);
    this.addSql(
      `grant insert (organization_id, name, description, address, access_info, latitude, longitude, visit_radius_m) on places to krajozbior_app;`,
    );
    this.addSql(
      `grant update (name, description, address, access_info, latitude, longitude, visit_radius_m, version, updated_at) on places to krajozbior_app;`,
    );
    this.addSql(
      `grant insert (collection_id, place_id, organization_id, position) on collection_places to krajozbior_app;`,
    );
    this.addSql(`grant update (position) on collection_places to krajozbior_app;`);
    this.addSql(`grant delete on collection_places to krajozbior_app;`);

    // collections
    this.addSql(`
      create policy collections_select on collections for select to krajozbior_app
        using (
          (status = 'published'
            and exists (select from public.organizations o
                         where o.id = collections.organization_id and o.status = 'approved'))
          or app_org_permission(organization_id) is not null
        );
    `);
    this.addSql(`
      create policy collections_insert on collections for insert to krajozbior_app
        with check (app_org_permission(organization_id) = 'full_edit' and status = 'draft');
    `);
    this.addSql(`
      create policy collections_update on collections for update to krajozbior_app
        using (app_org_permission(organization_id) = 'full_edit')
        with check (app_org_permission(organization_id) = 'full_edit');
    `);
    this.addSql(`
      create policy collections_delete on collections for delete to krajozbior_app
        using (
          status = 'draft' and first_published_at is null
          and app_org_permission(organization_id) = 'full_edit'
        );
    `);

    // places: visible to the creating organization's members, and to everyone
    // when the place is in a publicly visible collection.
    this.addSql(`
      create policy places_select on places for select to krajozbior_app
        using (
          app_org_permission(organization_id) is not null
          or exists (
            select
              from public.collection_places cp
             where cp.place_id = places.id
               and ${publicCollection("cp.collection_id")}
          )
        );
    `);
    this.addSql(`
      create policy places_insert on places for insert to krajozbior_app
        with check (app_org_permission(organization_id) = 'full_edit');
    `);
    this.addSql(`
      create policy places_update on places for update to krajozbior_app
        using (app_org_permission(organization_id) = 'full_edit')
        with check (app_org_permission(organization_id) = 'full_edit');
    `);

    // collection_places
    this.addSql(`
      create policy collection_places_select on collection_places for select to krajozbior_app
        using (
          app_org_permission(organization_id) is not null
          or ${publicCollection("collection_places.collection_id")}
        );
    `);
    this.addSql(`
      create policy collection_places_insert on collection_places for insert to krajozbior_app
        with check (app_org_permission(organization_id) = 'full_edit');
    `);
    this.addSql(`
      create policy collection_places_update on collection_places for update to krajozbior_app
        using (app_org_permission(organization_id) = 'full_edit')
        with check (app_org_permission(organization_id) = 'full_edit');
    `);
    this.addSql(`
      create policy collection_places_delete on collection_places for delete to krajozbior_app
        using (app_org_permission(organization_id) = 'full_edit');
    `);
  }

  override async down(): Promise<void> {
    // Tables tied by policies and keys go in one statement, without CASCADE.
    this.addSql(`drop table collection_places, places, collections;`);
    this.addSql(`drop function collections_publication();`);
  }
}
