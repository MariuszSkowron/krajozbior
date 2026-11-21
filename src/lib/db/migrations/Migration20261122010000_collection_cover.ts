import { Migration } from "@mikro-orm/migrations";

// E4-3: okładka kolekcji ze zdjęcia oficjalnego miejsca (specyfikacja E4, 5.1, D-E4-7).
//
// `collections.cover_place_photo_id` wskazuje zdjęcie z `place_photos`; `on delete set null`
// (usunięcie zdjęcia zostawia kolekcję bez okładki). Druga kolumna ze specyfikacji
// (`cover_explorer_photo_id` i `check (num_nonnulls(...) <= 1)`) powstanie razem z tabelą
// `explorer_photos` w E4-4/E4-5; dziś nie ma do czego się odwoływać [P].
//
// - `krajozbior_app` dostaje `UPDATE` tylko tej jednej kolumny (polityka `collections_update`
//   już wymaga `full_edit`). `INSERT` bez tej kolumny: nowa kolekcja nie ma okładki. Odczyt jest
//   szerszy niż kolumna, bo `select` na całej tabeli obejmuje nową kolumnę: sam identyfikator
//   zdjęcia nic nie zdradza, a plik i podpis oddaje `place_photos` według własnych polityk RLS.
// - Wyzwalacz `collections_cover_guard` (`security definer`): okładką jest tylko zdjęcie gotowe,
//   nieukryte, z miejsca, które jest w tej kolekcji. Działa jako właściciel, bo aplikacja nie ma
//   uprawnienia do `place_photos.hidden_at`. Błąd `23514`.
// - Wyzwalacze czyszczące (`security definer`): okładka znika, gdy zdjęcie przestaje być gotowe
//   albo zostaje ukryte (`place_photos`), i gdy miejsce okładki wychodzi z kolekcji
//   (`collection_places`). Czyszczą także zapisy roli operatora (`photos:fetch`, ukrycie).
// - Wąskie polityki dla `krajozbior_owner` (funkcje `security definer` czytają tabele z FORCE):
//   odczyt `collection_places` tylko dla miejsc ze zdjęciem gotowym oraz odczyt i wyzerowanie
//   okładki tylko w wierszach, które ją mają. Polityki permisywne łączą się przez OR, więc
//   funkcje właściciela filtrują tabele także same w treści.

const guardFunction = "collections_cover_guard";
const photoCleanupFunction = "place_photos_clear_cover";
const linkCleanupFunction = "collection_places_clear_cover";

export class Migration20261122010000_collection_cover extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table collections
        add column cover_place_photo_id uuid null references place_photos (id) on delete set null;
    `);
    // Klucz obcy `set null` szuka wierszy po tej kolumnie.
    this.addSql(`
      create index collections_cover_place_photo_id_idx on collections (cover_place_photo_id)
        where cover_place_photo_id is not null;
    `);
    this.addSql(`grant update (cover_place_photo_id) on collections to krajozbior_app;`);

    // Strażnik: okładka tylko z gotowego, nieukrytego zdjęcia miejsca z tej kolekcji.
    this.addSql(`
      create function ${guardFunction}() returns trigger
      language plpgsql security definer
      set search_path = ''
      as $$
      begin
        if new.cover_place_photo_id is null then
          return new;
        end if;

        if not exists (
          select
            from public.place_photos ph
            join public.collection_places cp on cp.place_id = ph.place_id
           where ph.id = new.cover_place_photo_id
             and cp.collection_id = new.id
             and ph.organization_id = new.organization_id
             and ph.file_state = 'ready'
             and ph.storage_key is not null
             and ph.hidden_at is null
        ) then
          raise exception 'collection cover photo is not a ready, visible photo of a place in the collection'
            using errcode = '23514', constraint = 'collections_cover_guard';
        end if;

        return new;
      end
      $$;
    `);
    this.addSql(`revoke all on function ${guardFunction}() from public;`);
    this.addSql(`
      create trigger collections_cover_guard
        before insert or update of cover_place_photo_id on collections
        for each row execute function ${guardFunction}();
    `);

    // Czyszczenie: zdjęcie ukryte albo niegotowe nie jest okładką.
    this.addSql(`
      create function ${photoCleanupFunction}() returns trigger
      language plpgsql security definer
      set search_path = ''
      as $$
      begin
        update public.collections
           set cover_place_photo_id = null, updated_at = now()
         where cover_place_photo_id = new.id;

        return null;
      end
      $$;
    `);
    this.addSql(`revoke all on function ${photoCleanupFunction}() from public;`);
    this.addSql(`
      create trigger place_photos_clear_cover
        after update of file_state, hidden_at on place_photos
        for each row
        when (new.hidden_at is not null or new.file_state <> 'ready')
        execute function ${photoCleanupFunction}();
    `);

    // Czyszczenie: miejsce okładki wychodzi z kolekcji.
    this.addSql(`
      create function ${linkCleanupFunction}() returns trigger
      language plpgsql security definer
      set search_path = ''
      as $$
      begin
        update public.collections c
           set cover_place_photo_id = null, updated_at = now()
         where c.id = old.collection_id
           and c.cover_place_photo_id in (
             select ph.id from public.place_photos ph where ph.place_id = old.place_id
           );

        return null;
      end
      $$;
    `);
    this.addSql(`revoke all on function ${linkCleanupFunction}() from public;`);
    this.addSql(`
      create trigger collection_places_clear_cover
        after delete on collection_places
        for each row execute function ${linkCleanupFunction}();
    `);

    // Wąskie polityki dla właściciela (funkcje wyżej działają jako właściciel tabel z FORCE).
    this.addSql(`
      create policy collections_owner_cover_select on collections
        for select to krajozbior_owner
        using (cover_place_photo_id is not null);
    `);
    this.addSql(`
      create policy collections_owner_cover_clear on collections
        for update to krajozbior_owner
        using (cover_place_photo_id is not null)
        with check (cover_place_photo_id is null);
    `);
    this.addSql(`
      create policy collection_places_owner_cover_select on collection_places
        for select to krajozbior_owner
        using (
          exists (
            select
              from public.place_photos ph
             where ph.place_id = collection_places.place_id and ph.storage_key is not null
          )
        );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger collection_places_clear_cover on collection_places;`);
    this.addSql(`drop trigger place_photos_clear_cover on place_photos;`);
    this.addSql(`drop trigger collections_cover_guard on collections;`);
    this.addSql(`drop function ${linkCleanupFunction}();`);
    this.addSql(`drop function ${photoCleanupFunction}();`);
    this.addSql(`drop function ${guardFunction}();`);
    this.addSql(`drop policy collection_places_owner_cover_select on collection_places;`);
    this.addSql(`drop policy collections_owner_cover_clear on collections;`);
    this.addSql(`drop policy collections_owner_cover_select on collections;`);
    this.addSql(`drop index collections_cover_place_photo_id_idx;`);
    this.addSql(`alter table collections drop column cover_place_photo_id;`);
  }
}
