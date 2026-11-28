import { Migration } from "@mikro-orm/migrations";

// Druga warstwa kolekcji: `collections.kind` oznacza, czy kolekcja jest krainą (`land`), czy
// mniejszą kolekcją z jednym tematem albo opowieścią (`theme`).
//
// - Brak nowej tabeli, polityk i ról: kolumna podlega istniejącym politykom `collections`
//   (RLS włączony i wymuszony): `collections_select`, `collections_insert`, `collections_update`
//   (zapis tylko członek organizacji z `full_edit`).
// - `krajozbior_app` dostaje `INSERT` i `UPDATE` tylko tej kolumny (odczyt ma z grantu na całą
//   tabelę). Zapis nie podnosi `version` ani `updated_at` (to porządek, nie treść).
// - `CHECK`: tylko `land` albo `theme` (test integracyjny catalog-access porównuje listę
//   z COLLECTION_KINDS z domeny).
// - Istniejące wiersze dostają `theme`, więc zachowanie po migracji jest takie samo jak przed nią.

export class Migration20261128100000_collection_kind extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table collections
        add column kind text not null default 'theme',
        add constraint collections_kind_check check (kind in ('land', 'theme'));
    `);
    this.addSql(`grant insert (kind), update (kind) on collections to krajozbior_app;`);
  }

  override async down(): Promise<void> {
    this.addSql(`revoke insert (kind), update (kind) on collections from krajozbior_app;`);
    this.addSql(`alter table collections drop constraint collections_kind_check;`);
    this.addSql(`alter table collections drop column kind;`);
  }
}
