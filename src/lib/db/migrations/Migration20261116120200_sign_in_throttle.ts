import { Migration } from "@mikro-orm/migrations";

// Request counters of the identity feature. The sign-in routes reserve an
// attempt in up to three buckets before a password or a sign-in code is
// checked: `account_ip:<hmac>:<ip>`, `ip:<ip>` and `account:<hmac>`. E-mail
// addresses are stored only as an HMAC, so the table does not reveal who tried
// to sign in or whether an account exists. `locked_until` is a manual block set
// by `npm run auth:throttle`. Per-user limits of authenticated actions use the
// same table under the `action:` prefix (PostgresActionRateLimiter).
//
// Like the rest of `auth`, only starter_auth may touch it.
export class Migration20261116120200_sign_in_throttle extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table auth.sign_in_throttle (
        key text primary key,
        attempts integer not null default 0 check (attempts >= 0),
        window_started_at timestamptz not null default now(),
        locked_until timestamptz
      );
    `);
    this.addSql(
      `create index sign_in_throttle_window_idx on auth.sign_in_throttle (window_started_at);`,
    );

    this.addSql(`revoke all on auth.sign_in_throttle from public, starter_app, starter_ops;`);
    this.addSql(`grant select, insert, update, delete on auth.sign_in_throttle to starter_auth;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table auth.sign_in_throttle;`);
  }
}
