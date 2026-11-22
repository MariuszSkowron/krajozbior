import { Migration } from "@mikro-orm/migrations";

// E4-3: okładka kolekcji ze zdjęcia oficjalnego miejsca (specyfikacja E4, 5.1, D-E4-7).
//
// `collections.cover_place_photo_id` wskazuje zdjęcie z `place_photos`. Druga kolumna ze
// specyfikacji (`cover_explorer_photo_id` i `check (num_nonnulls(...) <= 1)`) powstanie razem z
// tabelą `explorer_photos` w E4-4/E4-5; dziś nie ma do czego się odwoływać [P].
//
// - `krajozbior_app` dostaje `UPDATE` tylko tej jednej kolumny (polityka `collections_update`
//   już wymaga `full_edit`). `INSERT` bez tej kolumny: nowa kolekcja nie ma okładki. Odczyt jest
//   szerszy niż kolumna, bo `select` na całej tabeli obejmuje nową kolumnę: sam identyfikator
//   zdjęcia nic nie zdradza, a plik i podpis oddaje `place_photos` według własnych polityk RLS.
// - Ukrycie zdjęcia pilnuje klucz obcy, nie wyzwalacz: `place_photos.cover_eligible` (kolumna
//   generowana: `hidden_at is null`, celowo BEZ `file_state`) jest częścią klucza
//   `(id, cover_eligible)`, a `collections.cover_eligible` (ustawia ją strażnik) jest równe `true`
//   przy okładce. Okładka ukrytego zdjęcia kończy się `23503`, a gdy zdjęcie stanie się ukryte
//   (rola operatora, polecenie ukrycia), `on update set null` zeruje okładkę sam (działanie
//   klucza obcego omija RLS i uprawnienia, więc operator nie potrzebuje praw do `collections`, a
//   właściciel nie dostaje żadnych polityk). Usunięcie zdjęcia też zeruje okładkę (`on delete
//   set null`). Powrót ukrytego zdjęcia do widoczności okładki nie przywraca: kurator wybiera ją
//   od nowa (spec: „kolekcja zostaje bez okładki”).
//   Stan pliku nie zeruje okładki: gdy `photos:fetch --refetch-missing` przestawi zdjęcie na
//   `pending_fetch` (np. po złym zamontowaniu wolumenu), wybór kuratora zostaje, a okładka nie jest
//   pokazywana (zapytania karty i nagłówka oraz polityka `place_photos` wymagają `ready`) do
//   czasu ponownego pobrania. Gotowość sprawdza strażnik przy wyborze (poniżej).
//   Aplikacja nie ma uprawnienia do `place_photos.cover_eligible`, więc kolumna nie zdradza
//   ukrycia zdjęcia.
// - Wyzwalacz `collections_cover_guard` (z uprawnieniami piszącego, jak `collections_publication`):
//   okładką jest tylko zdjęcie gotowe z miejsca, które jest w tej kolekcji i organizacji (`23514`).
//   Powiązanie miejsca z kolekcją jest blokowane `for key share` do końca transakcji, więc
//   równoległe usunięcie miejsca z kolekcji czeka na zatwierdzenie okładki i po nim wyzwalacz
//   czyszczący widzi już nową okładkę (nie zostaje okładka miejsca spoza kolekcji).
//   Kurator widzi własne wiersze `collection_places` i `place_photos` (polityki); zdjęcie obcej
//   organizacji jest dla niego niewidoczne, więc kończy się tak samo jak nieistniejące.
// - Wyzwalacz `collection_places_clear_cover` (po usunięciu miejsca z kolekcji, z uprawnieniami
//   piszącego): okładka z tego miejsca znika. Usuwa powiązania tylko kurator organizacji (polityka
//   `collection_places_delete`), który ma też `UPDATE` okładki własnej kolekcji.

const guardFunction = "collections_cover_guard";
const linkCleanupFunction = "collection_places_clear_cover";

export class Migration20261122010000_collection_cover extends Migration {
  override async up(): Promise<void> {
    // Część klucza obcego: czy zdjęcie może być okładką.
    this.addSql(`
      alter table place_photos
        add column cover_eligible boolean
          generated always as (hidden_at is null) stored;
    `);
    this.addSql(`
      alter table place_photos
        add constraint place_photos_id_cover_eligible_key unique (id, cover_eligible);
    `);

    // `cover_eligible` kolekcji nie jest kolumną generowaną: `on update set null` klucza obcego
    // musi móc ją wyzerować razem ze wskaźnikiem (dla kolumny generowanej PostgreSQL odmawia).
    // Ustawia ją strażnik (poniżej): `true` przy okładce, `null` bez niej; ograniczenie pilnuje
    // zgodności, a aplikacja nie ma uprawnienia do jej zapisu.
    this.addSql(`alter table collections add column cover_place_photo_id uuid null;`);
    this.addSql(`alter table collections add column cover_eligible boolean null;`);
    this.addSql(`
      alter table collections
        add constraint collections_cover_eligible_check
          check (
            (cover_place_photo_id is null and cover_eligible is null)
            or (cover_place_photo_id is not null and cover_eligible is true)
          );
    `);
    // MATCH SIMPLE: bez okładki (`null`) klucz nie sprawdza niczego. Oba działania zerują obie
    // kolumny (lista kolumn w `set null` działa tylko przy `on delete`).
    this.addSql(`
      alter table collections
        add constraint collections_cover_place_photo_fkey
          foreign key (cover_place_photo_id, cover_eligible)
          references place_photos (id, cover_eligible)
          on delete set null
          on update set null;
    `);
    // Działania klucza obcego (`set null`) szukają wierszy po tej kolumnie.
    this.addSql(`
      create index collections_cover_place_photo_id_idx on collections (cover_place_photo_id)
        where cover_place_photo_id is not null;
    `);
    this.addSql(`grant update (cover_place_photo_id) on collections to krajozbior_app;`);

    // Strażnik: okładka tylko z gotowego zdjęcia miejsca z tej kolekcji i organizacji.
    this.addSql(`
      create function ${guardFunction}() returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if new.cover_place_photo_id is null then
          new.cover_eligible := null;

          return new;
        end if;

        new.cover_eligible := true;

        -- for key share of cp blokuje usuniecie powiazania do konca transakcji (wyscig z
        -- collection_places_clear_cover); kuratorowi wystarcza grant kolumnowy update (position).
        perform 1
           from public.place_photos ph
           join public.collection_places cp on cp.place_id = ph.place_id
          where ph.id = new.cover_place_photo_id
            and cp.collection_id = new.id
            and ph.organization_id = new.organization_id
            and ph.file_state = 'ready'
            and ph.storage_key is not null
            for key share of cp;

        if not found then
          raise exception 'collection cover photo is not a ready photo of a place in the collection'
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

    // Czyszczenie: miejsce okładki wychodzi z kolekcji.
    this.addSql(`
      create function ${linkCleanupFunction}() returns trigger
      language plpgsql
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
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger collection_places_clear_cover on collection_places;`);
    this.addSql(`drop trigger collections_cover_guard on collections;`);
    this.addSql(`drop function ${linkCleanupFunction}();`);
    this.addSql(`drop function ${guardFunction}();`);
    this.addSql(`drop index collections_cover_place_photo_id_idx;`);
    this.addSql(`alter table collections drop constraint collections_cover_place_photo_fkey;`);
    this.addSql(`alter table collections drop column cover_eligible;`);
    this.addSql(`alter table collections drop column cover_place_photo_id;`);
    this.addSql(`alter table place_photos drop constraint place_photos_id_cover_eligible_key;`);
    this.addSql(`alter table place_photos drop column cover_eligible;`);
  }
}
