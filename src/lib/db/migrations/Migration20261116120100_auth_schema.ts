import { Migration } from "@mikro-orm/migrations";

// Storage of Better Auth (src/features/identity/infrastructure/better-auth.ts):
// users, credential accounts, sessions and verification codes in a dedicated
// `auth` schema. Column names follow Better Auth's snake_case mapping.
// `users.role` is limited to the roles of the krajozbior and defaults to the least
// privileged one.
//
// Access is limited by role, not by row policies (docs/data-isolation.md):
// only krajozbior_auth, the identity adapter's role, has privileges here;
// krajozbior_app and krajozbior_ops have none. krajozbior_auth may insert and change
// every column of auth.users except `role`: a new account always gets the
// default `user`, and the adapter can neither create an admin nor promote an
// existing account. Another role is set by krajozbior_owner from an operator
// script (src/features/identity/infrastructure/user-role.ts).
const userColumnsWithoutRole = "name, email, email_verified, image, updated_at";
const insertableUserColumns = `id, ${userColumnsWithoutRole}, created_at`;

export class Migration20261116120100_auth_schema extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create schema auth;`);

    this.addSql(`
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        email text not null unique,
        email_verified boolean not null default false,
        image text,
        role text not null default 'user' check (role in ('user', 'admin')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    this.addSql(`
      create table auth.sessions (
        id uuid primary key default gen_random_uuid(),
        expires_at timestamptz not null,
        token text not null unique,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        ip_address text,
        user_agent text,
        user_id uuid not null references auth.users (id) on delete cascade
      );
    `);
    this.addSql(`create index sessions_user_id_idx on auth.sessions (user_id);`);

    this.addSql(`
      create table auth.accounts (
        id uuid primary key default gen_random_uuid(),
        account_id text not null,
        provider_id text not null,
        user_id uuid not null references auth.users (id) on delete cascade,
        access_token text,
        refresh_token text,
        id_token text,
        access_token_expires_at timestamptz,
        refresh_token_expires_at timestamptz,
        scope text,
        password text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (provider_id, account_id)
      );
    `);
    this.addSql(`create index accounts_user_id_idx on auth.accounts (user_id);`);

    this.addSql(`
      create table auth.verifications (
        id uuid primary key default gen_random_uuid(),
        identifier text not null,
        value text not null,
        expires_at timestamptz not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);
    this.addSql(`create index verifications_identifier_idx on auth.verifications (identifier);`);

    this.addSql(`revoke all on schema auth from public;`);
    this.addSql(
      `revoke all on all tables in schema auth from public, krajozbior_app, krajozbior_ops;`,
    );
    this.addSql(`grant usage on schema auth to krajozbior_auth;`);
    this.addSql(`grant select, delete on auth.users to krajozbior_auth;`);
    this.addSql(`grant insert (${insertableUserColumns}) on auth.users to krajozbior_auth;`);
    this.addSql(`grant update (${userColumnsWithoutRole}) on auth.users to krajozbior_auth;`);
    this.addSql(`
      grant select, insert, update, delete
        on auth.sessions, auth.accounts, auth.verifications
        to krajozbior_auth;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop schema auth cascade;`);
  }
}
