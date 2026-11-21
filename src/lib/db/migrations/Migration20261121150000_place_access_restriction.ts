import { Migration } from "@mikro-orm/migrations";

// E1-S11 (R-14): a place a curator marks as private, fenced or a ruin shows a
// warning not to enter the grounds. One public column of `places`, like the
// rest of the place: `none` (default, nothing changes for existing rows),
// `private`, `fenced` or `ruin`.
//
// Row security, the policies and the other grants of `places` stay as they
// are: the column joins the column grants of INSERT and UPDATE of
// `krajozbior_app`, so it is written under the same policy (`full_edit` of the
// organization) as the name or the coordinates. A guest, an explorer and a
// member of another organization write nothing.

export class Migration20261121150000_place_access_restriction extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table places
        add column access_restriction text not null default 'none'
          check (access_restriction in ('none', 'private', 'fenced', 'ruin'));
    `);
    this.addSql(`grant insert (access_restriction) on places to krajozbior_app;`);
    this.addSql(`grant update (access_restriction) on places to krajozbior_app;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table places drop column access_restriction;`);
  }
}
