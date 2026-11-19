import { Migration } from "@mikro-orm/migrations";

// Loading an approved collection file (PR-A1: the database part only).
//
// 1. `catalog_import_keys` remembers, per organization, which place or
//    collection was created from which key of a file, in which version, so a
//    second load of the same file changes nothing and never overwrites what a
//    curator edited in the panel. CUR class (metadata of the organization): the
//    members of the organization read it, a member with `full_edit` writes it,
//    a guest and a member of another organization see nothing.
//    `entity_id` is unique per organization and kind, not globally, so a
//    duplicate-key error never tells a curator anything about another
//    organization.
//    `entity_id` has no foreign key (it points at two tables); the loader
//    removes the key in the same transaction as the entity.
//    `imported_places` holds the composition and order of a collection as the
//    loader left it: adding, removing and reordering places in the panel does
//    not raise `collections.version`, so only this column shows a manual edit.
// 2. `places_delete`: a curator with `full_edit` may delete a place of the own
//    organization that belongs to no collection. A visit or a "want to see"
//    entry still protects the place (`on delete restrict`, SQLSTATE 23503). The
//    change reaches the whole catalog, not only the loader.

const entityKinds = `'collection', 'place'`;
// The exact shape of a key per kind is checked by the file validator; the
// database only keeps the keys short and free of odd characters.
const keyPattern = `'^[a-z]{1,8}:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'`;

export class Migration20261119104409_catalog_import extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table catalog_import_keys (
        organization_id uuid not null references organizations (id),
        entity_kind text not null check (entity_kind in (${entityKinds})),
        import_key text not null check (import_key ~ ${keyPattern}),
        entity_id uuid not null,
        batch_id text not null check (char_length(batch_id) between 1 and 80),
        imported_version integer not null check (imported_version >= 1),
        imported_places uuid[] null,
        imported_at timestamptz not null default now(),
        primary key (organization_id, entity_kind, import_key),
        unique (organization_id, entity_kind, entity_id),
        constraint catalog_import_keys_places_check
          check ((entity_kind = 'collection') or imported_places is null)
      );
    `);

    this.addSql(`alter table catalog_import_keys enable row level security;`);
    // FORCE: the table owner is bound by the policies too.
    this.addSql(`alter table catalog_import_keys force row level security;`);
    this.addSql(`revoke all on catalog_import_keys from public;`);
    this.addSql(`grant select, delete on catalog_import_keys to krajozbior_app;`);
    this.addSql(
      `grant insert (organization_id, entity_kind, import_key, entity_id, batch_id, imported_version, imported_places) on catalog_import_keys to krajozbior_app;`,
    );
    this.addSql(
      `grant update (entity_id, batch_id, imported_version, imported_places, imported_at) on catalog_import_keys to krajozbior_app;`,
    );

    this.addSql(`
      create policy catalog_import_keys_select on catalog_import_keys for select to krajozbior_app
        using (app_org_permission(organization_id) is not null);
    `);
    this.addSql(`
      create policy catalog_import_keys_insert on catalog_import_keys for insert to krajozbior_app
        with check (app_org_permission(organization_id) = 'full_edit');
    `);
    this.addSql(`
      create policy catalog_import_keys_update on catalog_import_keys for update to krajozbior_app
        using (app_org_permission(organization_id) = 'full_edit')
        with check (app_org_permission(organization_id) = 'full_edit');
    `);
    this.addSql(`
      create policy catalog_import_keys_delete on catalog_import_keys for delete to krajozbior_app
        using (app_org_permission(organization_id) = 'full_edit');
    `);

    this.addSql(`grant delete on places to krajozbior_app;`);
    this.addSql(`
      create policy places_delete on places for delete to krajozbior_app
        using (
          app_org_permission(organization_id) = 'full_edit'
          and not exists (
            select
              from public.collection_places cp
             where cp.place_id = places.id
          )
        );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop policy places_delete on places;`);
    this.addSql(`revoke delete on places from krajozbior_app;`);
    this.addSql(`drop table catalog_import_keys;`);
  }
}
