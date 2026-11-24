import { Migration } from "@mikro-orm/migrations";

// Paczka 4 (kurator, minimum): kurator widzi, ilu odkrywców zapisało jego kolekcję. Tylko liczba
// zbiorcza, nigdy lista osób: `saved_collections` zostaje tabelą PRIV (każdy czyta wyłącznie
// swoje wiersze), a jedyną drogą kuratora do liczby jest funkcja `app_collection_saves`.
//
// - Funkcja `security definer` (właściciel `krajozbior_owner`), `set search_path = ''`, EXECUTE
//   tylko dla `krajozbior_app`. Zwraca pary (kolekcja, liczba) wyłącznie dla kolekcji organizacji
//   zatwierdzonej, której członkiem jest aktor z sesji (`app_current_user_id()`); dla cudzej
//   organizacji i dla gościa zwraca zero wierszy.
// - Właściciel potrzebuje odczytu przez wąskie polityki (tabele mają FORCE): `saved_collections`
//   (funkcja agreguje, nie zwraca wierszy) i kolekcje, które kiedykolwiek były opublikowane
//   (tylko takie mogą być zapisane; szkic bez publikacji nie ma zapisów). Wycofana kolekcja
//   zachowuje zapisy (D-15), więc jej liczba też jest widoczna.

export class Migration20261124040000_collection_saves_for_curator extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create policy saved_collections_owner_count on saved_collections
        for select to krajozbior_owner using (true);
    `);
    this.addSql(`
      create policy collections_owner_saves_select on collections
        for select to krajozbior_owner using (first_published_at is not null);
    `);
    this.addSql(`
      create function app_collection_saves(p_organization_id uuid)
      returns table (collection_id uuid, saves integer)
      language sql stable security definer
      set search_path = ''
      as $$
        select c.id, count(s.user_id)::int
          from public.collections c
          join public.saved_collections s on s.collection_id = c.id
         where c.organization_id = p_organization_id
           and c.first_published_at is not null
           and exists (
             select
               from public.organization_members m
               join public.organizations o on o.id = m.organization_id
              where m.organization_id = p_organization_id
                and m.user_id = public.app_current_user_id()
                and o.status = 'approved'
           )
         group by c.id
      $$;
    `);
    this.addSql(`revoke all on function app_collection_saves(uuid) from public;`);
    this.addSql(`grant execute on function app_collection_saves(uuid) to krajozbior_app;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop function app_collection_saves(uuid);`);
    this.addSql(`drop policy collections_owner_saves_select on collections;`);
    this.addSql(`drop policy saved_collections_owner_count on saved_collections;`);
  }
}
