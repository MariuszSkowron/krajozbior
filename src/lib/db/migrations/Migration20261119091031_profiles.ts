import { Migration } from "@mikro-orm/migrations";

// E9-2, `profiles`: the profile of an explorer (first name, the first letter of
// the family name, region, who may see the profile). Class "Prywatna z wyborem"
// (docs/data-isolation.md, section 2): today only the owner reads and writes the
// row. The policies below are the owner policies of PRIV tables; E9-7 will add a
// narrow function for a profile the owner made public, and it adds its own
// policy for `krajozbior_owner`, not for `krajozbior_app`.
//
// - `user_id` defaults to `app_current_user_id()` and `krajozbior_app` has no
//   INSERT privilege on it, so a row of somebody else cannot even be named;
//   the WITH CHECK of the policy is the second barrier.
// - No row means the defaults (D-E9-2): a profile that is private, without a
//   name. The row appears with the first save (`insert ... on conflict do update`).
// - No DELETE for `krajozbior_app`: the row goes with the account (cascade).
// - UPDATE only on the columns the explorer edits, plus `updated_at`.
// - Frozen CHECK list: a copy of REGIONS in src/features/catalog/domain (the
//   16 voivodeships, D-15); an integration test compares them.
//
// A migration is a frozen file and loads no other module of the application, so
// the statements of privateTableSecuritySql() in src/lib/db/policies.ts for the
// operations select, insert and update are spelled out here; the tests check the
// result.
function privateTableSecuritySql(
  table: string,
  { operations }: { operations: readonly ("select" | "insert" | "update")[] },
): string[] {
  const isOwner = `user_id = (select app_current_user_id())`;
  const policy = (operation: "select" | "insert" | "update") => {
    const create = `create policy ${table}_owner_${operation} on public.${table} for ${operation} to krajozbior_app`;

    switch (operation) {
      case "insert":
        return `${create} with check (${isOwner});`;
      case "update":
        return `${create} using (${isOwner}) with check (${isOwner});`;
      default:
        return `${create} using (${isOwner});`;
    }
  };

  return [
    `alter table public.${table} enable row level security;`,
    `alter table public.${table} force row level security;`,
    `revoke all on public.${table} from public;`,
    `grant ${operations.join(", ")} on public.${table} to krajozbior_app;`,
    ...operations.map(policy),
  ];
}

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

export class Migration20261119091031_profiles extends Migration {
  override name = "Migration20261119091031_profiles";

  override async up(): Promise<void> {
    // The letters themselves are checked by the domain rule of the application
    // (src/features/profile/domain); the database keeps the shape: 1-40 characters, no control
    // characters, no outer spaces; the initial is one uppercase letter and only
    // together with a name.
    this.addSql(`
      create table profiles (
        user_id uuid primary key default app_current_user_id()
          references auth.users (id) on delete cascade,
        first_name text null check (
          first_name is null or (
            char_length(first_name) between 1 and 40
            and first_name !~ '[[:cntrl:]]'
            and first_name = btrim(first_name)
          )
        ),
        family_initial text null check (
          family_initial is null or (
            char_length(family_initial) = 1
            and family_initial = upper(family_initial)
            and family_initial <> lower(family_initial)
          )
        ),
        region text null check (region is null or region in (${regions})),
        visibility text not null default 'private' check (visibility in ('private', 'public')),
        updated_at timestamptz not null default now(),
        constraint profiles_initial_needs_name_check
          check (family_initial is null or first_name is not null)
      );
    `);
    for (const statement of privateTableSecuritySql("profiles", {
      operations: ["select", "insert", "update"],
    })) {
      this.addSql(statement);
    }
    // Column grants: the explorer supplies only these; the owner of the row is
    // the default of `user_id`, the time is the default of `updated_at`.
    this.addSql(`revoke insert, update on profiles from krajozbior_app;`);
    this.addSql(
      `grant insert (first_name, family_initial, region, visibility) on profiles to krajozbior_app;`,
    );
    this.addSql(
      `grant update (first_name, family_initial, region, visibility, updated_at) on profiles to krajozbior_app;`,
    );
    this.addSql(`revoke all on profiles from krajozbior_auth, krajozbior_ops;`);
  }

  override async down(): Promise<void> {
    // The policies go with the table; no other table or policy refers to it.
    this.addSql(`drop table profiles;`);
  }
}
