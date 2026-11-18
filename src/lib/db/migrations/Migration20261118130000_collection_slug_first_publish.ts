import { Migration } from "@mikro-orm/migrations";

// D-27: a collection that was never published gets its address from the title
// at the first publication; after it the address never changes.
//
// The column "when first published" already exists (`first_published_at`, set
// only by the trigger), so no new column and no backfill: every collection
// published so far has it and therefore keeps its address.
//
// - krajozbior_app gets `update (slug)`. The grant alone would allow any change,
//   so the publication trigger decides: the new slug is kept only in the update
//   that moves the row to `published` for the first time (old.first_published_at
//   is null); in every other update (also a title edit of a draft, a withdrawal
//   or a repeat publication) the old slug is restored. Row policies are
//   unchanged; the unique index still guards collisions (the application
//   draws another suffix).

const publicationFunction = (keepSlugRule: string) => `
      create or replace function collections_publication() returns trigger
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
${keepSlugRule}
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
`;

const keepSlugAfterFirstPublication = `
          -- The address may change only in the update of the first publication.
          if v_old_first is not null
             or new.status is distinct from 'published'
             or v_old_status = 'published' then
            new.slug := old.slug;
          end if;
`;

export class Migration20261118130000_collection_slug_first_publish extends Migration {
  override async up(): Promise<void> {
    this.addSql(publicationFunction(keepSlugAfterFirstPublication));
    this.addSql(`grant update (slug) on collections to krajozbior_app;`);
  }

  override async down(): Promise<void> {
    this.addSql(`revoke update (slug) on collections from krajozbior_app;`);
    // Back to the function of the catalog migration (no rule about the slug).
    this.addSql(publicationFunction(""));
  }
}
