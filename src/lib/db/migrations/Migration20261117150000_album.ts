import { Migration } from "@mikro-orm/migrations";

// A migration is a frozen file and loads no other module of the application
// (the migrator cannot resolve extensionless imports), so the statements of
// privateTableSecuritySql() in src/lib/db/policies.ts for the operations select,
// insert and delete are spelled out here; the tests check the result.
function privateTableSecuritySql(
  table: string,
  { operations }: { operations: readonly ("select" | "insert" | "delete")[] },
): string[] {
  const isOwner = `user_id = (select app_current_user_id())`;
  const policy = (operation: "select" | "insert" | "delete") =>
    `create policy ${table}_owner_${operation} on public.${table} for ${operation} to krajozbior_app ` +
    (operation === "insert" ? `with check (${isOwner});` : `using (${isOwner});`);

  return [
    `alter table public.${table} enable row level security;`,
    `alter table public.${table} force row level security;`,
    `revoke all on public.${table} from public;`,
    `grant ${operations.join(", ")} on public.${table} to krajozbior_app;`,
    ...operations.map(policy),
  ];
}

// Album of an explorer (E2, PR5; docs/data-isolation.md sections 2 and 5; spec
// D-T3, table 5.1): saved collections, the want-to-see list and visits, all PRIV.
//
// - The three tables are written only by their owner in the user context. The
//   owner's own rows are the only rows anybody can read: a curator has no path
//   to them at all (R-09).
// - "Publicly visible" is an explicit query in the restrictive INSERT policies
//   (published collection of an approved organization), never "visible through
//   the SELECT policy": the policies of a curator show their own drafts, so a
//   write "by visibility" would let a member save or visit a draft place (W2).
// - A visit on site is created by record_on_site_visit() only. krajozbior_app
//   may insert `past` visits (a restrictive policy `to krajozbior_app` demands
//   kind = 'past', so the policy does not bind krajozbior_owner, whose function
//   inserts `on_site`). The function and its checklist: spec D-T3.
// - A visit stores the place, the server time and the kind. No position and no
//   accuracy, anywhere (D-14).
// - Frozen CHECK lists (copies of VISIT_KINDS and DATE_PRECISIONS in
//   src/features/visits/domain; an integration test compares them).

const visitKinds = `'on_site', 'past'`;
const datePrecisions = `'day', 'month', 'year', 'unknown'`;

// A collection published by an approved organization, as an explicit query.
const publicCollection = (collection: string) => `
  exists (
    select
      from public.collections pc
      join public.organizations po on po.id = pc.organization_id
     where pc.id = ${collection}
       and pc.status = 'published'
       and po.status = 'approved'
  )`;

// A place that belongs to at least one publicly visible collection.
const publicPlace = (place: string) => `
  exists (
    select
      from public.collection_places cp
      join public.collections pc on pc.id = cp.collection_id
      join public.organizations po on po.id = pc.organization_id
     where cp.place_id = ${place}
       and pc.status = 'published'
       and po.status = 'approved'
  )`;

export class Migration20261117150000_album extends Migration {
  override async up(): Promise<void> {
    // on delete restrict: a collection saved by anybody cannot be deleted, even
    // by a role that is not bound by the DELETE policy of collections.
    this.addSql(`
      create table saved_collections (
        user_id uuid not null references auth.users (id) on delete cascade,
        collection_id uuid not null references collections (id) on delete restrict,
        saved_at timestamptz not null default now(),
        primary key (user_id, collection_id)
      );
    `);
    this.addSql(
      `create index saved_collections_collection_id_idx on saved_collections (collection_id);`,
    );
    for (const statement of privateTableSecuritySql("saved_collections", {
      operations: ["select", "insert", "delete"],
    })) {
      this.addSql(statement);
    }
    // INSERT only on the columns the application may supply; timestamps and the id come from defaults (D1).
    this.addSql(`revoke insert on saved_collections from krajozbior_app;`);
    this.addSql(`grant insert (user_id, collection_id) on saved_collections to krajozbior_app;`);
    this.addSql(`revoke all on saved_collections from krajozbior_auth, krajozbior_ops;`);
    this.addSql(`
      create policy saved_collections_published_insert on saved_collections
        as restrictive for insert to krajozbior_app
        with check (${publicCollection("saved_collections.collection_id")});
    `);

    this.addSql(`
      create table want_to_see_places (
        user_id uuid not null references auth.users (id) on delete cascade,
        place_id uuid not null references places (id) on delete restrict,
        saved_at timestamptz not null default now(),
        primary key (user_id, place_id)
      );
    `);
    this.addSql(`create index want_to_see_places_place_id_idx on want_to_see_places (place_id);`);
    for (const statement of privateTableSecuritySql("want_to_see_places", {
      operations: ["select", "insert", "delete"],
    })) {
      this.addSql(statement);
    }
    // INSERT only on the columns the application may supply; timestamps and the id come from defaults (D1).
    this.addSql(`revoke insert on want_to_see_places from krajozbior_app;`);
    this.addSql(`grant insert (user_id, place_id) on want_to_see_places to krajozbior_app;`);
    this.addSql(`revoke all on want_to_see_places from krajozbior_auth, krajozbior_ops;`);
    this.addSql(`
      create policy want_to_see_places_published_insert on want_to_see_places
        as restrictive for insert to krajozbior_app
        with check (${publicPlace("want_to_see_places.place_id")});
    `);

    // \`date_precision\` is null only for \`on_site\`; \`visited_on\` is null for
    // \`on_site\` and for "I do not remember". \`client_visit_id\` makes a visit on
    // site idempotent (unique with user_id; NULL values never collide, so only
    // \`past\` visits may leave it empty and the CHECK says so, V4).
    this.addSql(`
      create table visits (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references auth.users (id) on delete cascade,
        place_id uuid not null references places (id) on delete restrict,
        kind text not null check (kind in (${visitKinds})),
        visited_at timestamptz not null default now(),
        visited_on date null,
        date_precision text null check (date_precision in (${datePrecisions})),
        client_visit_id uuid null,
        created_at timestamptz not null default now(),
        constraint visits_date_precision_kind_check
          check ((kind = 'on_site') = (date_precision is null)),
        constraint visits_visited_on_precision_check
          check ((date_precision is null or date_precision = 'unknown') = (visited_on is null)),
        constraint visits_client_visit_id_check
          check (kind = 'past' or client_visit_id is not null),
        constraint visits_user_id_client_visit_id_key unique (user_id, client_visit_id)
      );
    `);
    this.addSql(`create index visits_user_id_idx on visits (user_id);`);
    this.addSql(`create index visits_place_id_idx on visits (place_id);`);
    for (const statement of privateTableSecuritySql("visits", {
      operations: ["select", "insert", "delete"],
    })) {
      this.addSql(statement);
    }
    // INSERT only on the columns the application may supply; timestamps and the id come from defaults (D1).
    this.addSql(`revoke insert on visits from krajozbior_app;`);
    this.addSql(
      `grant insert (user_id, place_id, kind, visited_on, date_precision, client_visit_id) on visits to krajozbior_app;`,
    );
    this.addSql(`revoke all on visits from krajozbior_auth, krajozbior_ops;`);
    this.addSql(`
      create policy visits_past_insert on visits
        as restrictive for insert to krajozbior_app
        with check (kind = 'past');
    `);
    this.addSql(`
      create policy visits_published_place_insert on visits
        as restrictive for insert to krajozbior_app
        with check (${publicPlace("visits.place_id")});
    `);

    // Narrow policies for the owner of record_on_site_visit() (the tables are
    // FORCEd, so a security definer function needs its own). Permissive
    // policies are OR-ed, so these cannot narrow the wider operator policies
    // of PR1 on organizations (using (true)): the function filters
    // organizations.status itself (M-1). It reads no other table of PR1.
    this.addSql(`
      create policy collections_owner_select on collections for select to krajozbior_owner
        using (
          status = 'published'
          and exists (select from public.organizations o
                       where o.id = collections.organization_id and o.status = 'approved')
        );
    `);
    this.addSql(`
      create policy collection_places_owner_select on collection_places
        for select to krajozbior_owner
        using (${publicCollection("collection_places.collection_id")});
    `);
    this.addSql(`
      create policy places_owner_select on places for select to krajozbior_owner
        using (${publicPlace("places.id")});
    `);
    this.addSql(`
      create policy visits_function_select on visits for select to krajozbior_owner
        using (user_id = (select app_current_user_id()));
    `);
    this.addSql(`
      create policy visits_function_insert on visits for insert to krajozbior_owner
        with check (user_id = (select app_current_user_id()) and kind = 'on_site');
    `);

    // Checklist D-T3 (nine points); the number is given in the comments.
    this.addSql(`
      create function record_on_site_visit(
        p_place_id uuid,
        p_latitude double precision,
        p_longitude double precision,
        p_accuracy_m double precision,
        p_client_visit_id uuid
      ) returns table (result text, distance_m integer)
      language plpgsql volatile security definer
      set search_path = pg_catalog, public, pg_temp
      as $$
      declare
        v_user uuid := public.app_current_user_id();
        v_place record;
        v_found boolean := false;
        v_a double precision;
        v_distance double precision;
        v_inserted integer;
        v_existing record;
      begin
        -- (1) guest; (2) the owner of the row is never a parameter
        if v_user is null then
          raise exception 'authentication required' using errcode = '42501';
        end if;

        -- (3) validation before any read; null and NaN/infinity fail "between"
        if p_place_id is null
           or p_client_visit_id is null
           or p_latitude is null or p_latitude not between -90 and 90
           or p_longitude is null or p_longitude not between -180 and 180
           or p_accuracy_m is null or p_accuracy_m not between 0 and 100000 then
          -- (9) no value in the message
          raise exception 'invalid visit input' using errcode = '22023';
        end if;

        -- (7) the place belongs to a published collection of an approved
        -- organization; membership of a curator is not enough. The explicit
        -- organizations.status filter is needed (M-1): the PR1 policy of the
        -- owner on organizations is using (true).
        for v_place in
          select p.latitude, p.longitude, p.visit_radius_m
            from public.places p
           where p.id = p_place_id
             and exists (
               select
                 from public.collection_places cp
                 join public.collections c on c.id = cp.collection_id
                 join public.organizations o on o.id = c.organization_id
                where cp.place_id = p.id
                  and c.status = 'published'
                  and o.status = 'approved'
             )
        loop
          v_found := true;
        end loop;

        if not v_found then
          result := 'not_found';
          distance_m := null;
          return next;
          return;
        end if;

        -- haversine on a sphere of the mean Earth radius, no PostGIS
        v_a := power(sin(radians(v_place.latitude - p_latitude) / 2), 2)
             + cos(radians(p_latitude)) * cos(radians(v_place.latitude))
               * power(sin(radians(v_place.longitude - p_longitude) / 2), 2);
        v_distance := 2 * 6371008.8 * asin(least(1, sqrt(v_a)));
        -- rounded up, so a distance just past the radius never looks inside it
        distance_m := ceil(v_distance)::integer;

        -- accuracy threshold: a fixed 150 m (D-14)
        if p_accuracy_m > 150 then
          result := 'inaccurate';
          distance_m := null;
          return next;
          return;
        end if;

        if v_distance > v_place.visit_radius_m then
          result := 'out_of_range';
          return next;
          return;
        end if;

        -- (6) idempotent: the same (user, client_visit_id) never adds a row
        insert into public.visits (user_id, place_id, kind, client_visit_id)
        values (v_user, p_place_id, 'on_site', p_client_visit_id)
        on conflict (user_id, client_visit_id) do nothing;
        get diagnostics v_inserted = row_count;

        if v_inserted = 0 then
          for v_existing in
            select v.place_id, v.kind
              from public.visits v
             where v.user_id = v_user
               and v.client_visit_id = p_client_visit_id
          loop
            if v_existing.place_id <> p_place_id or v_existing.kind <> 'on_site' then
              raise exception 'client_visit_id already used' using errcode = '22023';
            end if;
          end loop;
        end if;

        result := 'recorded';
        return next;
      end
      $$;
    `);
    // (5) execute only for krajozbior_app
    this.addSql(
      `revoke all on function record_on_site_visit(uuid, double precision, double precision, double precision, uuid) from public, krajozbior_auth, krajozbior_ops;`,
    );
    this.addSql(
      `grant execute on function record_on_site_visit(uuid, double precision, double precision, double precision, uuid) to krajozbior_app;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop function record_on_site_visit(uuid, double precision, double precision, double precision, uuid);`,
    );
    // The owner policies on tables of an earlier migration go first; the three
    // tables, tied by policies and keys, go in one statement, without CASCADE.
    this.addSql(`drop policy collections_owner_select on collections;`);
    this.addSql(`drop policy collection_places_owner_select on collection_places;`);
    this.addSql(`drop policy places_owner_select on places;`);
    this.addSql(`drop table visits, want_to_see_places, saved_collections;`);
  }
}
