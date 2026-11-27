import { Migration } from "@mikro-orm/migrations";

// Kraina w kilku województwach: `collections.extra_regions` (0-3 dodatkowych kodów województw
// obok głównego `region`).
//
// - Brak nowej tabeli, polityk i ról: kolumna podlega istniejącym politykom `collections`
//   (RLS włączony i wymuszony): `collections_select`, `collections_insert`, `collections_update`
//   (zapis tylko członek organizacji z `full_edit`).
// - `krajozbior_app` dostaje `INSERT` i `UPDATE` tylko tej kolumny. Zapis nie podnosi `version`
//   ani `updated_at` (to miejsce w filtrze, nie treść).
// - `CHECK`: kody tylko ze zamrożonej listy (kopia REGIONS z src/features/catalog/domain;
//   test integracyjny catalog-access je porównuje), najwyżej 3 elementy, bez województwa głównego,
//   bez `null` w tablicy. Powtórzeń nie sprawdza (wymagałoby funkcji); pilnuje ich domena.
// - Istniejące wiersze dostają `'{}'`, więc zachowanie po migracji jest takie samo jak przed nią.

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

export class Migration20261128010000_collection_extra_regions extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table collections
        add column extra_regions text[] not null default '{}',
        add constraint collections_extra_regions_check check (
          extra_regions <@ array[${regions}]::text[]
          and cardinality(extra_regions) <= 3
          and not (region = any(extra_regions))
          and array_position(extra_regions, null) is null
        );
    `);
    this.addSql(
      `grant insert (extra_regions), update (extra_regions) on collections to krajozbior_app;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `revoke insert (extra_regions), update (extra_regions) on collections from krajozbior_app;`,
    );
    this.addSql(`alter table collections drop constraint collections_extra_regions_check;`);
    this.addSql(`alter table collections drop column extra_regions;`);
  }
}
