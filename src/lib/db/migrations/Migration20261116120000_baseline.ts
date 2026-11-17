import { Migration } from "@mikro-orm/migrations";

// Baseline of the krajozbior (docs/data-isolation.md):
// - a guard: migrations run only as krajozbior_owner and only after
//   `npm run db:roles` created the runtime roles, so no object is ever owned by
//   the cluster administrator or by a runtime role;
// - app_current_user_id(): row policies read the user of the transaction from
//   `app.user_id`, which the application sets with set_config(..., true) inside
//   each transaction (src/lib/db/user-context.ts). Without the setting it
//   returns NULL, so policies match no rows (fails closed);
// - functions are not executable by PUBLIC by default; each migration grants
//   EXECUTE to the role that needs it.
//
// MikroORM runs pending migrations in one transaction, so a failed guard
// applies nothing.
export class Migration20261116120000_baseline extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if current_user <> 'krajozbior_owner' then
          raise exception 'Migrations must run as krajozbior_owner (DATABASE_MIGRATION_URL)';
        end if;

        if (select count(*) from pg_roles
             where rolname in ('krajozbior_app', 'krajozbior_auth', 'krajozbior_ops')) <> 3 then
          raise exception 'Database roles are missing: run npm run db:roles first';
        end if;
      end $$;
    `);

    this.addSql(
      `alter default privileges for role krajozbior_owner revoke execute on functions from public;`,
    );

    this.addSql(`
      create or replace function app_current_user_id() returns uuid
      language sql stable
      as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    `);
    this.addSql(`revoke all on function app_current_user_id() from public;`);
    this.addSql(`grant execute on function app_current_user_id() to krajozbior_app;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop function if exists app_current_user_id();`);
    this.addSql(
      `alter default privileges for role krajozbior_owner grant execute on functions to public;`,
    );
  }
}
