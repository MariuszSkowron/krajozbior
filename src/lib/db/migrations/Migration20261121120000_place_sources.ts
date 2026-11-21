import { Migration } from "@mikro-orm/migrations";

// Sources of a place (PR-B of the collection files): the signature of the data
// the place was made from (a licence duty, CC BY 4.0), the link to the article
// and the way the description was written.
//
// `place_sources` is public like the place it describes: a row is visible when
// the place is (the subquery runs under the policy `places_select`, so a draft
// place of another organization shows nothing). A member of the organization
// with `full_edit` writes it, as with `places`. A guest, an explorer and a
// member of another organization write nothing.
//
// The composite foreign key makes the organization of the row the one of the
// place, so the policy cannot be satisfied with a foreign place id. Deleting a
// place deletes its row.

export class Migration20261121120000_place_sources extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table place_sources (
        place_id uuid primary key,
        organization_id uuid not null,
        wikidata_qid text null check (wikidata_qid ~ '^Q[0-9]+$'),
        wikipedia_url text null
          check (wikipedia_url ~ '^https://pl\\.wikipedia\\.org/wiki/' and char_length(wikipedia_url) <= 500),
        description_method text not null check (description_method in ('facts_template', 'curator')),
        attribution text not null check (char_length(attribution) between 1 and 500),
        retrieved_at timestamptz not null,
        foreign key (place_id, organization_id)
          references places (id, organization_id) on delete cascade
      );
    `);

    this.addSql(`alter table place_sources enable row level security;`);
    // FORCE: the table owner is bound by the policies too.
    this.addSql(`alter table place_sources force row level security;`);
    this.addSql(`revoke all on place_sources from public;`);
    this.addSql(`grant select on place_sources to krajozbior_app;`);
    this.addSql(
      `grant insert (place_id, organization_id, wikidata_qid, wikipedia_url, description_method, attribution, retrieved_at) on place_sources to krajozbior_app;`,
    );
    this.addSql(
      `grant update (wikidata_qid, wikipedia_url, description_method, attribution, retrieved_at) on place_sources to krajozbior_app;`,
    );

    this.addSql(`
      create policy place_sources_select on place_sources for select to krajozbior_app
        using (
          app_org_permission(organization_id) is not null
          or exists (select from public.places p where p.id = place_sources.place_id)
        );
    `);
    this.addSql(`
      create policy place_sources_insert on place_sources for insert to krajozbior_app
        with check (app_org_permission(organization_id) = 'full_edit');
    `);
    this.addSql(`
      create policy place_sources_update on place_sources for update to krajozbior_app
        using (app_org_permission(organization_id) = 'full_edit')
        with check (app_org_permission(organization_id) = 'full_edit');
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table place_sources;`);
  }
}
