import { Migration } from "@mikro-orm/migrations";

// Daily counters of sign-in code requests (PostgresOtpSendLimiter): per
// address, per address from one IP, per IP and one global row, each for one
// UTC day. Addresses and IPs are stored only as an HMAC (bucket names such as
// `email:<hmac>`, `ip:<hmac>`, `global`). The 15-minute windows of the same
// limiter live in auth.sign_in_throttle under the `otp_send:` prefix.
//
// Like the rest of `auth`, only krajozbior_auth may touch it (no RLS: krajozbior_app
// and krajozbior_ops have no privileges in this schema at all).
export class Migration20261117120000_otp_send_counters extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table auth.otp_send_counters (
        bucket text not null,
        day date not null,
        count integer not null default 0 check (count >= 0),
        primary key (bucket, day)
      );
    `);
    this.addSql(`create index otp_send_counters_day_idx on auth.otp_send_counters (day);`);

    this.addSql(
      `revoke all on auth.otp_send_counters from public, krajozbior_app, krajozbior_ops;`,
    );
    this.addSql(
      `grant select, insert, update, delete on auth.otp_send_counters to krajozbior_auth;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table auth.otp_send_counters;`);
  }
}
