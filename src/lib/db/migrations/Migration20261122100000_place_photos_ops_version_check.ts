import { Migration } from "@mikro-orm/migrations";

// E4-2a, poprawka przypięcia wersji pliku z Commons: `photos:fetch` (rola `krajozbior_ops`) tuż
// przed pobraniem miniatury pyta API Commons o bieżącą wersję pliku i porównuje ją z dniem doboru
// (`retrieved_at`) oraz z licencją wiersza (`license_code`). Do tego rola potrzebuje odczytu tych
// dwóch kolumn i niczego więcej.
//
// Bez nowej tabeli i bez zmiany polityk: `place_photos_ops_select` już pozwala operatorowi czytać
// wiersze, a grant kolumnowy zawęża odczyt do kolumn, które operator zna (poprzedni grant:
// `id, place_id, organization_id, source_kind, file_state, storage_key, commons_file, width, height,
// source_width, fetch_attempts, created_at`). Aplikacja (`krajozbior_app`) nadal nie czyta
// `retrieved_at`; inne role bez zmian.

export class Migration20261122100000_place_photos_ops_version_check extends Migration {
  override async up(): Promise<void> {
    this.addSql(`grant select (retrieved_at, license_code) on place_photos to krajozbior_ops;`);
  }

  override async down(): Promise<void> {
    this.addSql(`revoke select (retrieved_at, license_code) on place_photos from krajozbior_ops;`);
  }
}
