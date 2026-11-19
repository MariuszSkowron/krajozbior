import { Migration } from "@mikro-orm/migrations";

// The domain normalizes the first name to NFC before it counts and checks it
// (src/features/profile/domain). The database keeps the same form, so a raw SQL
// write or a future second writer cannot store a decomposed name whose length
// the CHECK `char_length(first_name) <= 40` would count differently. Only a CHECK
// is added: the table, its row security, policies and grants stay as they are.
export class Migration20261119105319_nfc_first_name extends Migration {
  override name = "Migration20261119105319_nfc_first_name";

  override async up(): Promise<void> {
    this.addSql(
      `alter table profiles add constraint profiles_first_name_nfc_check check (first_name is null or first_name is nfc normalized);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table profiles drop constraint profiles_first_name_nfc_check;`);
  }
}
