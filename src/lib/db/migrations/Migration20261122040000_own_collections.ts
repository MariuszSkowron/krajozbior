import { Migration } from "@mikro-orm/migrations";

// E8-1a: prywatne kolekcje odkrywców (specyfikacja E8, 5.1, D-E8-3, B1, B3).
//
// Klasa danych „Prywatna z wyborem” (docs/data-isolation.md, sekcja 2). W tym kroku wszystko
// jest prywatne: kolumn publikacji, kopii `public_*`, adresu i decyzji nie ma (dojdą w E8-4a).
//
// `user_collections`
// - właściciel to `owner_user_id` (domyślnie `app_current_user_id()`, bez grantu `INSERT` na tę
//   kolumnę); polityki to wzorzec `privateTableSecuritySql()` z kolumną właściciela.
// - `krajozbior_app`: `SELECT`, `INSERT (title, summary, region)`, `UPDATE (title, summary,
//   region)`, `DELETE`. Brak grantu na `version` i `updated_at`: ustawia je wyzwalacz przez `NEW`
//   (B3), więc aplikacja nie może cofnąć wersji.
//
// `user_collection_items`
// - wpis nie ma własnego właściciela: ma go kolekcja (polityki sprawdzają ją podzapytaniem).
// - `place_id … on delete set null` (E8-Q19): kurator może usunąć swoje miejsce także wtedy, gdy
//   jest we wpisie odkrywcy. To zwykły `UPDATE` wykonywany przez klucz obcy (omija RLS i grant),
//   więc na wpisach NIE MA wyzwalacza `BEFORE UPDATE` ani strażnika stanów (lekcja 2026-11-22);
//   gdyby kiedyś powstał, dostaje jawny wyjątek dla zerowania `place_id`.
// - `place_name_snapshot` ustawia wyłącznie wyzwalacz `BEFORE INSERT` z uprawnieniami piszącego
//   (`security invoker`, B1): nazwa miejsca widocznego dla odkrywcy; dla niewidocznego wychodzi
//   `null` (nic nie ujawnia), a zapis i tak odrzuca polityka albo `CHECK`. Aplikacja nie ma
//   grantu na tę kolumnę, więc surowy `insert` z nią kończy się `42501`.
// - Restrykcyjna polityka `INSERT` (klucz obcy omija RLS): `place_id` musi wskazywać miejsce
//   publiczne w chwili dodania (kolekcja opublikowana organizacji zatwierdzonej). W E8-2 dojdzie
//   `user_place_id` i ta polityka zostanie zastąpiona.
// - Limity (50 własnych, 200 łącznie z zapisanymi, 200 wpisów) liczy baza w transakcji zapisu pod
//   blokadą doradczą (repozytorium), nie ogranicznik akcji.
//
// Migracja jest zamrożonym plikiem i nie ładuje kodu aplikacji: instrukcje
// `privateTableSecuritySql()` (src/lib/db/policies.ts) są tu wypisane; testy sprawdzają wynik.

const REGIONS = [
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
  "polska",
];

const regionList = REGIONS.map((region) => `'${region}'`).join(", ");

const ownsCollection = `
  exists (
    select
      from public.user_collections uc
     where uc.id = user_collection_items.user_collection_id
       and uc.owner_user_id = (select app_current_user_id())
  )`;

export class Migration20261122040000_own_collections extends Migration {
  override name = "Migration20261122040000_own_collections";

  override async up(): Promise<void> {
    this.addSql(`
      create table user_collections (
        id uuid primary key default gen_random_uuid(),
        owner_user_id uuid not null default app_current_user_id()
          references auth.users (id) on delete cascade,
        title text not null check (char_length(title) between 1 and 120),
        summary text not null default '' check (char_length(summary) <= 280),
        region text not null check (region in (${regionList})),
        version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);
    this.addSql(
      `create index user_collections_owner_idx on user_collections (owner_user_id, created_at desc);`,
    );

    // Wersja i czas przez `NEW`, bez grantu (B3). Reaguje tylko na kolumny treści.
    this.addSql(`
      create function user_collections_bump_version() returns trigger
        language plpgsql
        set search_path = ''
      as $$
      begin
        new.version := old.version + 1;
        new.updated_at := now();
        return new;
      end;
      $$;
    `);
    this.addSql(`
      create trigger user_collections_bump_version
        before update of title, summary, region on user_collections
        for each row execute function user_collections_bump_version();
    `);

    this.addSql(`alter table public.user_collections enable row level security;`);
    this.addSql(`alter table public.user_collections force row level security;`);
    this.addSql(`revoke all on public.user_collections from public;`);
    this.addSql(
      `grant select, insert, update, delete on public.user_collections to krajozbior_app;`,
    );
    this.addSql(`revoke insert, update on public.user_collections from krajozbior_app;`);
    this.addSql(
      `grant insert (title, summary, region) on public.user_collections to krajozbior_app;`,
    );
    this.addSql(
      `grant update (title, summary, region) on public.user_collections to krajozbior_app;`,
    );
    for (const operation of ["select", "delete"] as const) {
      this.addSql(`
        create policy user_collections_owner_${operation} on public.user_collections
          for ${operation} to krajozbior_app
          using (owner_user_id = (select app_current_user_id()));
      `);
    }
    this.addSql(`
      create policy user_collections_owner_insert on public.user_collections
        for insert to krajozbior_app
        with check (owner_user_id = (select app_current_user_id()));
    `);
    this.addSql(`
      create policy user_collections_owner_update on public.user_collections
        for update to krajozbior_app
        using (owner_user_id = (select app_current_user_id()))
        with check (owner_user_id = (select app_current_user_id()));
    `);
    this.addSql(`revoke all on public.user_collections from krajozbior_auth, krajozbior_ops;`);

    this.addSql(`
      create table user_collection_items (
        id uuid primary key default gen_random_uuid(),
        user_collection_id uuid not null references user_collections (id) on delete cascade,
        position integer not null check (position >= 1),
        place_id uuid null references places (id) on delete set null,
        place_name_snapshot text null
          check (place_name_snapshot is null or char_length(place_name_snapshot) between 1 and 120),
        added_at timestamptz not null default now(),
        constraint user_collection_items_position_key
          unique (user_collection_id, position) deferrable initially deferred,
        constraint user_collection_items_place_key unique (user_collection_id, place_id),
        -- B1: wpis z miejscem katalogu zawsze ma nazwę; wpis bez miejsca tylko jako „usunięte przez
        -- kuratora” (nazwa z chwili dodania).
        constraint user_collection_items_name_check
          check (place_id is null or place_name_snapshot is not null),
        constraint user_collection_items_content_check
          check (place_id is not null or place_name_snapshot is not null)
      );
    `);
    // Działanie `on delete set null` klucza obcego szuka wierszy po tej kolumnie.
    this.addSql(
      `create index user_collection_items_place_idx on user_collection_items (place_id) where place_id is not null;`,
    );

    // B1: nazwa miejsca z chwili dodania, zawsze z bazy (wartość z żądania jest nadpisywana).
    // `security invoker`: odkrywca widzi miejsce publiczne przez `places_select`, więc wyzwalacz
    // nie potrzebuje polityki właściciela; dla miejsca niewidocznego wychodzi `null`.
    this.addSql(`
      create function user_collection_items_set_place_name() returns trigger
        language plpgsql
        set search_path = ''
      as $$
      begin
        if new.place_id is not null then
          new.place_name_snapshot := (
            select p.name from public.places p where p.id = new.place_id
          );
        end if;
        return new;
      end;
      $$;
    `);
    this.addSql(`
      create trigger user_collection_items_place_name
        before insert on user_collection_items
        for each row execute function user_collection_items_set_place_name();
    `);

    this.addSql(`alter table public.user_collection_items enable row level security;`);
    this.addSql(`alter table public.user_collection_items force row level security;`);
    this.addSql(`revoke all on public.user_collection_items from public;`);
    this.addSql(`grant select, delete on public.user_collection_items to krajozbior_app;`);
    this.addSql(
      `grant insert (user_collection_id, position, place_id) on public.user_collection_items to krajozbior_app;`,
    );
    this.addSql(`
      create policy user_collection_items_owner_select on public.user_collection_items
        for select to krajozbior_app
        using (${ownsCollection});
    `);
    this.addSql(`
      create policy user_collection_items_owner_insert on public.user_collection_items
        for insert to krajozbior_app
        with check (${ownsCollection});
    `);
    this.addSql(`
      create policy user_collection_items_owner_delete on public.user_collection_items
        for delete to krajozbior_app
        using (${ownsCollection});
    `);
    // Klucz obcy omija RLS: bez tej polityki ktoś, kto zna UUID miejsca ze szkicu kuratora,
    // mógłby je przypiąć. Miejsce musi być w opublikowanej kolekcji zatwierdzonej organizacji.
    this.addSql(`
      create policy user_collection_items_place_visible on public.user_collection_items
        as restrictive for insert to krajozbior_app
        with check (
          place_id is not null
          and exists (
            select
              from public.places p
             where p.id = user_collection_items.place_id
               and exists (
                 select
                   from public.collection_places pcp
                   join public.collections c on c.id = pcp.collection_id
                   join public.organizations o on o.id = c.organization_id
                  where pcp.place_id = p.id
                    and c.status = 'published' and o.status = 'approved'
               )
               and exists (
                 select
                   from public.organizations po
                  where po.id = p.organization_id and po.status = 'approved'
               )
          )
        );
    `);
    this.addSql(`revoke all on public.user_collection_items from krajozbior_auth, krajozbior_ops;`);
  }

  override async down(): Promise<void> {
    // Tabele są powiązane kluczem obcym i politykami: jedna instrukcja, bez CASCADE.
    this.addSql(`drop table user_collection_items, user_collections;`);
    this.addSql(`drop function user_collection_items_set_place_name();`);
    this.addSql(`drop function user_collections_bump_version();`);
  }
}
