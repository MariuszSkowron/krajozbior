import { Migration } from "@mikro-orm/migrations";

// F-K3, `terms_acceptance`: który odkrywca zaakceptował którą wersję regulaminu i kiedy
// (E11-Q4 A, ekran „Zanim zaczniesz”). Klasa PRIV (docs/data-isolation.md, sekcja 2): konto
// czyta i dodaje tylko własne wpisy.
//
// - `user_id` ma wartość domyślną `app_current_user_id()`, a `krajozbior_app` nie ma `INSERT`
//   na tej kolumnie, więc cudzego właściciela nie da się nawet nazwać; `WITH CHECK` polityki
//   to druga bariera.
// - Wpis nigdy nie jest zmieniany ani usuwany przez aplikację (bez `UPDATE` i `DELETE`): ślad
//   akceptacji jest dowodem. Znika razem z kontem (kaskada z `auth.users`).
// - Klucz główny `(user_id, terms_version)`: jedna akceptacja jednej wersji; nowa wersja
//   regulaminu to nowy wiersz.
// - Ta migracja musi poprzedzać migrację dziennika z F-K6 (kolejność znaczników czasu).
//
// Migracja to zamrożony plik i nie ładuje innych modułów aplikacji, więc instrukcje
// privateTableSecuritySql() z src/lib/db/policies.ts dla operacji select i insert są tu
// wypisane wprost; testy sprawdzają wynik.
function privateTableSecuritySql(
  table: string,
  { operations }: { operations: readonly ("select" | "insert")[] },
): string[] {
  const isOwner = `user_id = (select app_current_user_id())`;
  const policy = (operation: "select" | "insert") => {
    const create = `create policy ${table}_owner_${operation} on public.${table} for ${operation} to krajozbior_app`;

    return operation === "insert"
      ? `${create} with check (${isOwner});`
      : `${create} using (${isOwner});`;
  };

  return [
    `alter table public.${table} enable row level security;`,
    `alter table public.${table} force row level security;`,
    `revoke all on public.${table} from public;`,
    `grant ${operations.join(", ")} on public.${table} to krajozbior_app;`,
    ...operations.map(policy),
  ];
}

export class Migration20261121100000_terms_acceptance extends Migration {
  override name = "Migration20261121100000_terms_acceptance";

  override async up(): Promise<void> {
    // Wersja to numer w postaci „0.2” albo „1”: cyfry rozdzielone kropkami (CURRENT_TERMS_VERSION
    // w src/features/terms/domain); baza pilnuje kształtu, nie konkretnej wartości.
    this.addSql(`
      create table terms_acceptance (
        user_id uuid not null default app_current_user_id()
          references auth.users (id) on delete cascade,
        terms_version text not null check (terms_version ~ '^[0-9]+(\\.[0-9]+){0,3}$'),
        accepted_at timestamptz not null default now(),
        primary key (user_id, terms_version)
      );
    `);
    for (const statement of privateTableSecuritySql("terms_acceptance", {
      operations: ["select", "insert"],
    })) {
      this.addSql(statement);
    }
    // Odkrywca podaje tylko wersję; właściciel i czas to wartości domyślne.
    this.addSql(`revoke insert on terms_acceptance from krajozbior_app;`);
    this.addSql(`grant insert (terms_version) on terms_acceptance to krajozbior_app;`);
    this.addSql(`revoke all on terms_acceptance from krajozbior_auth, krajozbior_ops;`);
  }

  override async down(): Promise<void> {
    // Polityki znikają razem z tabelą; żadna inna tabela się do niej nie odwołuje.
    this.addSql(`drop table terms_acceptance;`);
  }
}
