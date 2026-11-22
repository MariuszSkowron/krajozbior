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
// - Wyzwalacz `collections_cover_guard` (działa z uprawnieniami piszącego, jak
//   `collections_publication`): okładką jest tylko zdjęcie gotowe, nieukryte, z miejsca, które
//   jest w tej kolekcji i organizacji. Kurator widzi własne wiersze `collection_places` i
//   `place_photos` (polityki), a kolumnę `hidden_at`, do której aplikacja nie ma uprawnienia,
//   czyta wąska funkcja `collection_cover_photo_hidden(uuid)` (`security definer`; odpowiada tylko
//   członkowi `full_edit` organizacji zdjęcia, obcemu zawsze `false`). Błąd `23514`. Dzięki temu
//   właściciel nie dostaje polityk na `collection_places` (test `visits-access` pilnuje, że
//   funkcje właściciela czytają tylko to, czego potrzebują).
// - Wyzwalacze czyszczące (`security definer`): okładka znika, gdy zdjęcie przestaje być gotowe
//   albo zostaje ukryte (`place_photos`), i gdy miejsce okładki wychodzi z kolekcji
//   (`collection_places`). Czyszczą także zapisy roli operatora (`photos:fetch`, ukrycie), która
//   nie ma uprawnień do `collections`; dlatego działają jako właściciel.
// - Dwie wąskie polityki dla `krajozbior_owner` na `collections` (funkcje czyszczące czytają tabelę
//   z FORCE): odczyt i wyzerowanie okładki tylko w wierszach, które ją mają (`with check`:
//   wynik ma `cover_place_photo_id is null`). Polityki permisywne łączą się przez OR, więc
//   funkcje właściciela filtrują tabele także same w treści.

const guardFunction = "collections_cover_guard";
const hiddenFunction = "collection_cover_photo_hidden";
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

    // Czy zdjęcie jest ukryte przez administratora: odpowiada tylko członkowi `full_edit`
    // organizacji zdjęcia (kurator widzi to i tak przez `curator_place_photo_flags` z E4-1);
    // wszystkim innym `false`, więc nikt obcy nie sprawdzi stanu cudzego zdjęcia po samym UUID.
    this.addSql(`
      create function ${hiddenFunction}(p_photo_id uuid) returns boolean
      language sql stable security definer
      set search_path = ''
      as $$
        select coalesce((
          select ph.hidden_at is not null
            from public.place_photos ph
           where ph.id = p_photo_id
             and public.app_org_permission(ph.organization_id) = 'full_edit'
        ), false)
      $$;
    `);
    this.addSql(`revoke all on function ${hiddenFunction}(uuid) from public;`);
    this.addSql(`grant execute on function ${hiddenFunction}(uuid) to krajozbior_app;`);

    // Strażnik: okładka tylko z gotowego, nieukrytego zdjęcia miejsca z tej kolekcji.
    this.addSql(`
      create function ${guardFunction}() returns trigger
      language plpgsql
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
        ) or public.${hiddenFunction}(new.cover_place_photo_id) then
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
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger collection_places_clear_cover on collection_places;`);
    this.addSql(`drop trigger place_photos_clear_cover on place_photos;`);
    this.addSql(`drop trigger collections_cover_guard on collections;`);
    this.addSql(`drop function ${linkCleanupFunction}();`);
    this.addSql(`drop function ${photoCleanupFunction}();`);
    this.addSql(`drop function ${guardFunction}();`);
    this.addSql(`drop function ${hiddenFunction}(uuid);`);
    this.addSql(`drop policy collections_owner_cover_clear on collections;`);
    this.addSql(`drop policy collections_owner_cover_select on collections;`);
    this.addSql(`drop index collections_cover_place_photo_id_idx;`);
    this.addSql(`alter table collections drop column cover_place_photo_id;`);
  }
}
