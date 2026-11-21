import { Migration } from "@mikro-orm/migrations";

// E9-4, `account_settings`: settings remembered on the account (today only the
// theme, so that a choice of the light theme comes back on every device after
// sign-in; docs#65 AC1, D-22 item 2 as read in Q11). Class "Prywatna"
// (docs/data-isolation.md, section 2): only the owner reads and writes the row.
//
// - `user_id` defaults to `app_current_user_id()` and `krajozbior_app` has no
//   INSERT privilege on it, so a row of somebody else cannot even be named;
//   the WITH CHECK of the policy is the second barrier.
// - No row means the default (night theme); the row appears with the first
//   change (`insert ... on conflict do update`).
// - No DELETE for `krajozbior_app`: the row goes with the account (cascade).
// - UPDATE only on the columns the owner edits, plus `updated_at`.
// - Columns of notifications and location are added by their own migrations,
//   together with the features (Q11); none is created ahead of time.
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

export class Migration20261121150000_account_settings extends Migration {
  override name = "Migration20261121150000_account_settings";

  override async up(): Promise<void> {
    this.addSql(`
      create table account_settings (
        user_id uuid primary key default app_current_user_id()
          references auth.users (id) on delete cascade,
        theme text not null default 'dark' check (theme in ('dark', 'light')),
        updated_at timestamptz not null default now()
      );
    `);
    for (const statement of privateTableSecuritySql("account_settings", {
      operations: ["select", "insert", "update"],
    })) {
      this.addSql(statement);
    }
    // Column grants: the owner supplies only the settings; the owner of the row
    // is the default of `user_id`, the time is the default of `updated_at`.
    this.addSql(`revoke insert, update on account_settings from krajozbior_app;`);
    this.addSql(`grant insert (theme) on account_settings to krajozbior_app;`);
    this.addSql(`grant update (theme, updated_at) on account_settings to krajozbior_app;`);
    this.addSql(`revoke all on account_settings from krajozbior_auth, krajozbior_ops;`);
  }

  override async down(): Promise<void> {
    // The policies go with the table; no other table or policy refers to it.
    this.addSql(`drop table account_settings;`);
  }
}
