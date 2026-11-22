import { createHmac } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { APIError, betterAuth, type BetterAuthOptions } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { PostgresDialect } from "kysely";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { opsRoleAssigner } from "@/features/identity/infrastructure/user-role";
import { limitSessionExpiry } from "@/features/identity/domain/session-policy";
import { createOrmConfig } from "@/lib/db/config";
import {
  closePool,
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// E10-S0: a trial, not a feature. Does Better Auth's `two-factor` plugin (TOTP
// and backup codes) work with our session hooks (auth-hooks.ts, session-policy.ts)?
// The plugin is configured only here, on a scratch database, with the real
// Better Auth 1.7.25 and the real krajozbior_auth role. Nothing in `src/` changes.
//
// Two instances share one pool:
//   - `real`: the production hooks as they are today (baseline, shows the break);
//   - `spike`: the same hooks wrapped by the test-local policy proposed in DT-E10-5
//     (the extra path group for admins, the 12 hours counted from the old session,
//     and an `after` hook that records the proof of the second step).
// The tables the plugin needs are created in `beforeAll` as krajozbior_owner,
// like a migration would, never in the production migrations.
const PASSWORD = "integration-only-password";
const ADMIN_EMAIL = "admin@demo.krajozbior.local";
const SECRET = "integration-only-secret-0123456789abcdef";
const HOUR_MS = 60 * 60 * 1000;
const TOTP_VERIFY_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

type DatabaseHooks = NonNullable<BetterAuthOptions["databaseHooks"]>;
type Observation = { path: string; hasSession: boolean; sessionCreatedAt: Date | null };
type AfterSeen = { path: string; newSessionId: string | null; sessionId: string | null };

let db: ScratchDatabase;
let orm: MikroORM;
let pool: Pool;
let adminId: string;
let closeAuth: () => Promise<void>;
let real: Awaited<ReturnType<typeof buildAuth>>;
let spike: Awaited<ReturnType<typeof buildAuth>>;
let createProductionHooks: () => DatabaseHooks;
let deleteExpiredSessions: (pool: Pool) => Promise<number>;
const observed: Observation[] = [];
const afterSeen: AfterSeen[] = [];

// ---------------------------------------------------------------- helpers

// A minimal cookie jar: enough for the session, challenge and trust-device cookies.
class Jar {
  private readonly cookies = new Map<string, string>();

  absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);

      if (value === "" || /max-age=0/i.test(attributes.join(";"))) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  has(fragment: string): boolean {
    return [...this.cookies.keys()].some((name) => name.includes(fragment));
  }

  headers(): Headers {
    const value = [...this.cookies].map(([name, cookie]) => `${name}=${cookie}`).join("; ");

    return new Headers(value === "" ? {} : { cookie: value });
  }
}

function base32Decode(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";

  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let at = 0; at + 8 <= bits.length; at += 8) {
    bytes.push(Number.parseInt(bits.slice(at, at + 8), 2));
  }

  return Buffer.from(bytes);
}

// RFC 6238, SHA-1, six digits, 30 seconds, from the `otpauth://` address.
function totp(uri: string, stepOffset = 0): string {
  const secret = base32Decode(new URL(uri).searchParams.get("secret") ?? "");
  const counter = Buffer.alloc(8);

  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + stepOffset));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = (digest[19] ?? 0) & 0xf;
  const value =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);

  return String(value % 1_000_000).padStart(6, "0");
}

// A code that is wrong now and in the neighbouring windows the plugin accepts.
const wrongCode = (uri: string) => totp(uri, 500);

async function json(response: Response): Promise<Record<string, unknown>> {
  return ((await response.json().catch(() => null)) ?? {}) as Record<string, unknown>;
}

type Auth = typeof real;

async function signIn(auth: Auth, jar: Jar, password = PASSWORD) {
  const response = await auth.api.signInEmail({
    body: { email: ADMIN_EMAIL, password },
    headers: jar.headers(),
    asResponse: true,
  });

  jar.absorb(response);

  return { response, body: await json(response) };
}

async function enable(auth: Auth, jar: Jar) {
  const response = await auth.api.enableTwoFactor({
    body: { password: PASSWORD },
    headers: jar.headers(),
    asResponse: true,
  });

  jar.absorb(response);
  const body = await json(response);

  return {
    response,
    uri: String(body.totpURI ?? ""),
    backupCodes: (body.backupCodes ?? []) as string[],
  };
}

async function verifyTotp(auth: Auth, jar: Jar, code: string, trustDevice?: boolean) {
  const response = await auth.api.verifyTOTP({
    body: { code, ...(trustDevice === undefined ? {} : { trustDevice }) },
    headers: jar.headers(),
    asResponse: true,
  });

  jar.absorb(response);

  return { response, body: await json(response) };
}

async function verifyBackup(auth: Auth, jar: Jar, code: string) {
  const response = await auth.api.verifyBackupCode({
    body: { code },
    headers: jar.headers(),
    asResponse: true,
  });

  jar.absorb(response);

  return { response, body: await json(response) };
}

async function currentSession(auth: Auth, jar: Jar) {
  return auth.api.getSession({ headers: jar.headers() });
}

type SessionRow = { id: string; created_at: Date; expires_at: Date };

async function sessions(): Promise<SessionRow[]> {
  const rows = await orm.em.execute<
    { id: string; created_at: string | Date; expires_at: string | Date }[]
  >(`select id, created_at, expires_at from auth.sessions where user_id = ? order by created_at`, [
    adminId,
  ]);

  // The raw driver may hand timestamps over as text.
  return rows.map((row) => ({
    id: row.id,
    created_at: new Date(row.created_at),
    expires_at: new Date(row.expires_at),
  }));
}

async function proofSessionIds(): Promise<string[]> {
  const rows = await orm.em.execute<{ session_id: string }[]>(
    `select session_id from auth.spike_mfa_proofs order by session_id`,
  );

  return rows.map((row) => row.session_id);
}

async function userFlags() {
  const [row] = await orm.em.execute<{ enabled: boolean }[]>(
    `select two_factor_enabled as enabled from auth.users where id = ?`,
    [adminId],
  );
  const [factor] = await orm.em.execute<
    { verified: boolean; failed: number; locked: Date | null }[]
  >(
    `select verified, failed_verification_count as failed, locked_until as locked
       from auth.two_factors where user_id = ?`,
    [adminId],
  );

  return { enabled: row?.enabled, factor };
}

// Enables TOTP on the admin account and finishes the first verification.
async function adminWithTotp(auth: Auth) {
  const jar = new Jar();

  await signIn(auth, jar);
  const setup = await enable(auth, jar);
  const first = await verifyTotp(auth, jar, totp(setup.uri));

  expect(first.response.status).toBe(200);

  return { jar, setup };
}

// Password step and second step in one go, like a person returning later.
async function fullSignIn(auth: Auth, uri: string) {
  const jar = new Jar();
  const step1 = await signIn(auth, jar);

  expect(step1.body.twoFactorRedirect).toBe(true);
  const step2 = await verifyTotp(auth, jar, totp(uri));

  return { jar, step1, step2 };
}

// -------------------------------------------------------- the two instances

function createSpikeHooks(production: DatabaseHooks): DatabaseHooks {
  const baseBefore = production.session?.create?.before;

  if (baseBefore === undefined) {
    throw new Error("the production session hook is missing");
  }

  return {
    ...production,
    session: {
      ...production.session,
      create: {
        before: async (session, context) => {
          if (context && TOTP_VERIFY_PATHS.has(context.path)) {
            const user = (await context.context.internalAdapter.findUserById(session.userId)) as {
              role?: unknown;
              twoFactorEnabled?: boolean;
            } | null;

            if (user?.role === "admin") {
              const current = context.context.session;
              const sameAccount = current?.user.id === session.userId;

              observed.push({
                path: context.path,
                hasSession: sameAccount,
                sessionCreatedAt: sameAccount ? new Date(current.session.createdAt) : null,
              });
              if (user.twoFactorEnabled !== true && !sameAccount) {
                throw new APIError("FORBIDDEN", { message: "staff_password_only" });
              }

              // Step 3 counts the 12 hours from the old session, step 2 from now.
              const createdAt = sameAccount
                ? new Date(current.session.createdAt)
                : new Date(session.createdAt ?? Date.now());
              const expiresAt = limitSessionExpiry("admin", createdAt, new Date(session.expiresAt));

              return { data: { ...session, expiresAt: expiresAt ?? new Date(0) } };
            }
          }

          return baseBefore(session, context);
        },
      },
    },
  };
}

// Same configuration as createAuth() in better-auth.ts (without the sign-in
// code plugin), plus the plugin under trial.
async function buildAuth(hooks: DatabaseHooks, withProof: boolean) {
  const { verifiedPool } = await import("@/features/identity/infrastructure/better-auth");
  const snake = (...names: string[]) =>
    Object.fromEntries(
      names.map((name) => [name, name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)]),
    );

  return betterAuth({
    secret: SECRET,
    telemetry: { enabled: false },
    database: {
      dialect: new PostgresDialect({ pool: verifiedPool(pool) }),
      type: "postgres",
      schemaName: "auth",
    },
    emailAndPassword: { enabled: true, disableSignUp: true, autoSignIn: false },
    user: {
      modelName: "users",
      fields: snake("emailVerified", "createdAt", "updatedAt", "twoFactorEnabled"),
      additionalFields: { role: { type: "string", required: false, input: false } },
    },
    session: {
      modelName: "sessions",
      fields: snake("expiresAt", "createdAt", "updatedAt", "ipAddress", "userAgent", "userId"),
      expiresIn: 30 * 24 * 60 * 60,
      disableSessionRefresh: true,
    },
    account: {
      modelName: "accounts",
      fields: snake(
        "accountId",
        "providerId",
        "userId",
        "accessToken",
        "refreshToken",
        "idToken",
        "accessTokenExpiresAt",
        "refreshTokenExpiresAt",
        "createdAt",
        "updatedAt",
      ),
    },
    verification: {
      modelName: "verifications",
      fields: snake("expiresAt", "createdAt", "updatedAt"),
    },
    databaseHooks: hooks,
    ...(withProof
      ? {
          hooks: {
            // The proof of the second step: written by the layer that sees the session.
            after: createAuthMiddleware(async (ctx) => {
              if (!TOTP_VERIFY_PATHS.has(ctx.path)) {
                return;
              }
              const returned = ctx.context.returned;
              if (returned instanceof Error) {
                return;
              }
              const newSessionId = ctx.context.newSession?.session.id ?? null;
              const sessionId = ctx.context.session?.session.id ?? null;

              afterSeen.push({ path: ctx.path, newSessionId, sessionId });
              const target = newSessionId ?? sessionId;
              if (target !== null) {
                await pool.query(
                  `insert into auth.spike_mfa_proofs (session_id, verified_at) values ($1, now())
                   on conflict (session_id) do update set verified_at = now()`,
                  [target],
                );
              }
            }),
          },
        }
      : {}),
    plugins: [
      twoFactor({
        // The label of the authenticator entry; no `otp` method, no e-mail codes.
        issuer: "Krajozbiór",
        schema: {
          // The column the plugin adds to the account; it is mapped here, not in `user.fields`.
          user: { fields: snake("twoFactorEnabled") },
          twoFactor: {
            modelName: "two_factors",
            fields: snake("userId", "backupCodes", "failedVerificationCount", "lockedUntil"),
          },
        },
      }),
    ],
    advanced: {
      cookiePrefix: "krajozbior",
      ipAddress: { disableIpTracking: true },
      database: { generateId: "uuid" },
    },
  });
}

// ------------------------------------------------------------------- setup

describe("E10-S0: two-factor plugin (TOTP) against our session hooks", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_admin_totp_spike");
    await db.migrate();
    orm = await MikroORM.init(createOrmConfig(db.adminUrl));

    // What E10-1 will need as migrations, run as krajozbior_owner like a real
    // migration (default privileges and ownership behave the same).
    const ddl = [
      `alter table auth.users add column two_factor_enabled boolean not null default false`,
      `grant insert (two_factor_enabled), update (two_factor_enabled) on auth.users to krajozbior_auth`,
      `create table auth.two_factors (
         id uuid primary key default gen_random_uuid(),
         secret text not null,
         backup_codes text not null,
         user_id uuid not null unique references auth.users (id) on delete cascade,
         verified boolean not null default true,
         failed_verification_count integer not null default 0,
         locked_until timestamptz
       )`,
      `grant select, insert, update, delete on auth.two_factors to krajozbior_auth`,
      `create table auth.spike_mfa_proofs (
         session_id uuid primary key references auth.sessions (id) on delete cascade,
         verified_at timestamptz not null default now()
       )`,
      `grant select, insert, update on auth.spike_mfa_proofs to krajozbior_auth`,
    ];

    await withClient(db.urls.krajozbior_owner, async (client: Client) => {
      for (const statement of ddl) {
        await client.query(statement);
      }
    });

    process.env.DATABASE_URL = db.urls.krajozbior_app;
    process.env.DATABASE_AUTH_URL = db.urls.krajozbior_auth;
    process.env.BETTER_AUTH_SECRET = SECRET;
    delete process.env.BETTER_AUTH_URL;

    ({ closeAuth } = await import("@/features/identity/infrastructure/better-auth"));
    ({ deleteExpiredSessions } =
      await import("@/features/identity/infrastructure/postgres-expired-sessions-cleanup"));
    const { createDatabaseHooks } = await import("@/features/identity/infrastructure/auth-hooks");
    const { seedDemoAccounts } = await import("@/features/identity/infrastructure/demo-accounts");

    await seedDemoAccounts(PASSWORD, opsRoleAssigner(db.urls.krajozbior_ops));

    pool = new Pool({ connectionString: db.urls.krajozbior_auth, max: 5 });
    createProductionHooks = createDatabaseHooks;
    real = await buildAuth(createDatabaseHooks(), false);
    spike = await buildAuth(createSpikeHooks(createDatabaseHooks()), true);

    const [admin] = await orm.em.execute<{ id: string }[]>(
      `select id from auth.users where email = ?`,
      [ADMIN_EMAIL],
    );
    adminId = admin?.id ?? "";
  }, 90_000);

  beforeEach(async () => {
    observed.length = 0;
    afterSeen.length = 0;
    await orm.em.execute(`delete from auth.two_factors`);
    await orm.em.execute(`update auth.users set two_factor_enabled = false`);
    await orm.em.execute(`delete from auth.sessions`);
    await orm.em.execute(`delete from auth.verifications`);
    await orm.em.execute(`truncate auth.sign_in_throttle`);
  });

  afterAll(async () => {
    await closeAuth?.();
    if (pool !== undefined) {
      await closePool(pool);
    }
    await orm?.close(true);
    await db?.drop();
  });

  // --------------------------------------------------------------- baseline

  describe("baseline: today's hooks, unchanged", () => {
    it("breaks the first TOTP verification and leaves the admin half-enabled (DT-E10-5 steps 2 and 3)", async () => {
      const jar = new Jar();

      expect((await signIn(real, jar)).response.status).toBe(200);
      const setup = await enable(real, jar);

      expect(setup.response.status).toBe(200);
      expect(setup.uri).toMatch(/^otpauth:\/\/totp\//);
      expect(setup.backupCodes).toHaveLength(10);
      // Setup alone neither enables TOTP nor changes the session.
      expect(await userFlags()).toMatchObject({ enabled: false, factor: { verified: false } });

      const refused = await verifyTotp(real, jar, totp(setup.uri));

      // maySignInOnPath() only knows the password path, so the admin is refused...
      expect(refused.response.status).toBe(403);
      expect(refused.body.message).toBe("staff_password_only");
      // ...but only after the plugin already flagged the account as enabled and
      // before it marked the secret verified.
      expect(await userFlags()).toMatchObject({ enabled: true, factor: { verified: false } });

      // The next password sign-in now ends in a challenge that offers no method,
      // and the code is refused: the admin is locked out until an operator resets it.
      const retry = new Jar();
      const step1 = await signIn(real, retry);

      expect(step1.body.twoFactorRedirect).toBe(true);
      expect(step1.body.twoFactorMethods).toEqual([]);
      expect((await verifyTotp(real, retry, totp(setup.uri))).response.status).toBe(400);
      expect(await sessions()).toHaveLength(1);
    });

    it("refuses an admin session on every path except the password sign-in", async () => {
      const context = {
        path: "/two-factor/verify-totp",
        context: { internalAdapter: (await real.$context).internalAdapter, session: null },
      };
      const before = createProductionHooks().session?.create?.before;
      const session = {
        userId: adminId,
        token: "t",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + HOUR_MS),
      };

      await expect(before?.(session as never, context as never)).rejects.toMatchObject({
        body: { message: "staff_password_only" },
      });
      await expect(
        before?.(session as never, { ...context, path: "/sign-in/email" } as never),
      ).resolves.toMatchObject({ data: expect.anything() });
    });
  });

  // ------------------------------------------------------ with the proposal

  describe("with the extra path group, the 12 hours from the old session and the proof hook", () => {
    it("password sign-in without TOTP: a normal 12 hour session and no proof of a second step", async () => {
      const jar = new Jar();
      const { response, body } = await signIn(spike, jar);

      expect(response.status).toBe(200);
      expect(body.twoFactorRedirect).toBeUndefined();
      const [row] = await sessions();

      expect((row?.expires_at.getTime() ?? 0) - (row?.created_at.getTime() ?? 0)).toBe(
        12 * HOUR_MS,
      );
      expect(await proofSessionIds()).toEqual([]);
      expect((await currentSession(spike, jar))?.user.twoFactorEnabled).toBe(false);
    });

    it("first verification with a session: new session, old one gone, 12 hours counted from the old one, proof written (steps 3, DT-E10-5)", async () => {
      const jar = new Jar();

      await signIn(spike, jar);
      const old = (await currentSession(spike, jar))?.session;

      // The old session is 11 hours old: only one hour of the limit is left.
      await orm.em.execute(`update auth.sessions set created_at = now() - interval '11 hours'`);
      const oldCreatedAt = new Date(Date.now() - 11 * HOUR_MS);
      const setup = await enable(spike, jar);
      const verified = await verifyTotp(spike, jar, totp(setup.uri));

      expect(verified.response.status).toBe(200);
      const rows = await sessions();

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).not.toBe(old?.id);
      // createSession gives the new session createdAt = now (so createdAt cannot
      // carry the 12 hour limit), but our hook shortened expires_at to the old limit.
      expect(Math.abs((rows[0]?.created_at.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);
      expect(
        Math.abs((rows[0]?.expires_at.getTime() ?? 0) - (oldCreatedAt.getTime() + 12 * HOUR_MS)),
      ).toBeLessThan(60_000);
      // The hook saw the old session in the request context (the E10-S0 question).
      expect(observed.at(-1)).toMatchObject({ path: "/two-factor/verify-totp", hasSession: true });
      expect(
        Math.abs((observed.at(-1)?.sessionCreatedAt?.getTime() ?? 0) - oldCreatedAt.getTime()),
      ).toBeLessThan(60_000);
      // `hooks.after` sees both the new session id and the old (request) one.
      expect(afterSeen.at(-1)).toMatchObject({ newSessionId: rows[0]?.id, sessionId: old?.id });
      expect(await proofSessionIds()).toEqual([rows[0]?.id]);
      expect(await userFlags()).toMatchObject({ enabled: true, factor: { verified: true } });
      expect((await currentSession(spike, jar))?.user.twoFactorEnabled).toBe(true);
    });

    it("sign-in with the second step: the password step leaves no session, the code gives a 12 hour one with a proof (steps 1 and 2)", async () => {
      const { setup } = await adminWithTotp(spike);

      await orm.em.execute(`delete from auth.sessions`);
      afterSeen.length = 0;
      const jar = new Jar();
      const step1 = await signIn(spike, jar);

      expect(step1.response.status).toBe(200);
      expect(step1.body).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
      expect(jar.has("session_token")).toBe(false);
      expect(jar.has("two_factor")).toBe(true);
      expect(await sessions()).toHaveLength(0);
      expect(await currentSession(spike, jar)).toBeNull();

      const step2 = await verifyTotp(spike, jar, totp(setup.uri));

      expect(step2.response.status).toBe(200);
      const [row] = await sessions();

      expect((row?.expires_at.getTime() ?? 0) - (row?.created_at.getTime() ?? 0)).toBe(
        12 * HOUR_MS,
      );
      expect(observed.at(-1)).toMatchObject({ hasSession: false });
      expect(afterSeen.at(-1)).toMatchObject({ newSessionId: row?.id, sessionId: null });
      expect(await proofSessionIds()).toEqual([row?.id]);
      expect((await currentSession(spike, jar))?.user).toMatchObject({
        role: "admin",
        twoFactorEnabled: true,
      });
    });

    it("rejects a wrong code, five wrong codes burn the challenge, ten lock the account", async () => {
      const { setup } = await adminWithTotp(spike);

      await orm.em.execute(`delete from auth.sessions`);

      // One challenge: a wrong code is a 401 and creates nothing.
      const first = new Jar();

      await signIn(spike, first);
      const wrong = await verifyTotp(spike, first, wrongCode(setup.uri));

      expect(wrong.response.status).toBe(401);
      expect(wrong.body.code).toBe("INVALID_CODE");
      expect(await sessions()).toHaveLength(0);
      expect(await proofSessionIds()).toEqual([]);

      for (let attempt = 1; attempt < 5; attempt += 1) {
        expect((await verifyTotp(spike, first, wrongCode(setup.uri))).response.status).toBe(401);
      }
      // Even the right code is refused after five failures of one challenge.
      const burned = await verifyTotp(spike, first, totp(setup.uri));

      expect(burned.response.status).toBe(400);
      expect(burned.body.code).toBe("TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE");
      expect(await sessions()).toHaveLength(0);

      // Second challenge, five more failures: ten in a row lock the account.
      const second = new Jar();

      await signIn(spike, second);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await verifyTotp(spike, second, wrongCode(setup.uri));
      }
      const flags = await userFlags();

      expect(flags.factor?.failed).toBeGreaterThanOrEqual(10);
      expect(flags.factor?.locked).not.toBeNull();

      // A third challenge with the right code is refused while locked.
      const third = new Jar();

      await signIn(spike, third);
      const locked = await verifyTotp(spike, third, totp(setup.uri));

      expect(locked.response.status).toBe(429);
      expect(locked.body.code).toBe("ACCOUNT_TEMPORARILY_LOCKED");
      expect(await sessions()).toHaveLength(0);
    });

    it("the same TOTP code can be used again inside its window (no replay protection)", async () => {
      const { setup } = await adminWithTotp(spike);
      const code = totp(setup.uri);
      const one = await fullSignIn(spike, setup.uri);

      expect(one.step2.response.status).toBe(200);
      await orm.em.execute(`delete from auth.sessions`);

      const jar = new Jar();

      await signIn(spike, jar);
      const again = await verifyTotp(spike, jar, code);

      // The plugin accepts a code again within its window (+-1 step), so E10-1
      // must treat TOTP as one factor with our own limiter, not as a single-use token.
      expect(again.response.status).toBe(200);
    });

    it("backup codes: each works once, the proof is written, and `disableSession` creates nothing", async () => {
      const { setup } = await adminWithTotp(spike);
      const [first, second] = setup.backupCodes;

      await orm.em.execute(`delete from auth.sessions`);
      const jar = new Jar();

      await signIn(spike, jar);
      const used = await verifyBackup(spike, jar, first ?? "");

      expect(used.response.status).toBe(200);
      const [row] = await sessions();

      expect(await proofSessionIds()).toEqual([row?.id]);
      expect((row?.expires_at.getTime() ?? 0) - (row?.created_at.getTime() ?? 0)).toBe(
        12 * HOUR_MS,
      );

      // The same code in a new sign-in is refused; another one still works.
      await orm.em.execute(`delete from auth.sessions`);
      const retry = new Jar();

      await signIn(spike, retry);
      const reused = await verifyBackup(spike, retry, first ?? "");

      expect(reused.response.status).toBe(401);
      expect(reused.body.code).toBe("INVALID_BACKUP_CODE");
      expect((await verifyBackup(spike, retry, second ?? "")).response.status).toBe(200);

      // With `disableSession` the challenge is not consumed and no session is
      // created: our route must never pass that flag from the client.
      await orm.em.execute(`delete from auth.sessions`);
      const bare = new Jar();

      await signIn(spike, bare);
      const third = await spike.api.verifyBackupCode({
        body: { code: setup.backupCodes[2] ?? "", disableSession: true },
        headers: bare.headers(),
        asResponse: true,
      });

      expect(third.status).toBe(200);
      expect(await sessions()).toHaveLength(0);
    });

    it("re-confirmation with a session: no new session, the proof is refreshed, failures are not counted (step 4)", async () => {
      const { jar, setup } = await adminWithTotp(spike);
      const [before] = await sessions();

      await orm.em.execute(
        `update auth.spike_mfa_proofs set verified_at = now() - interval '1 hour'`,
      );
      const ok = await verifyTotp(spike, jar, totp(setup.uri));

      expect(ok.response.status).toBe(200);
      const after = await sessions();

      expect(after.map((row) => row.id)).toEqual([before?.id]);
      expect(afterSeen.at(-1)).toMatchObject({ newSessionId: null, sessionId: before?.id });
      const [proof] = await orm.em.execute<{ fresh: boolean }[]>(
        `select verified_at > now() - interval '1 minute' as fresh from auth.spike_mfa_proofs`,
      );

      expect(proof?.fresh).toBe(true);

      // Eight wrong codes in a row: all plain 401s. The plugin counts nothing in
      // this mode and its built-in limit (3 per 10 seconds) lives only in the HTTP
      // router, which we do not mount, so our own route needs a limiter.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const wrong = await verifyTotp(spike, jar, wrongCode(setup.uri));

        expect(wrong.response.status).toBe(401);
      }
      expect((await userFlags()).factor).toMatchObject({ failed: 0, locked: null });
      // A failed code leaves the stored proof as it was.
      expect(await proofSessionIds()).toEqual([before?.id]);
    });

    it("the proof does not survive its session: sign-out, sign-out everywhere and cleanup of expired sessions (S7)", async () => {
      const { setup } = await adminWithTotp(spike);
      const a = await fullSignIn(spike, setup.uri);
      const b = await fullSignIn(spike, setup.uri);
      const c = await fullSignIn(spike, setup.uri);

      expect((await sessions()).length).toBeGreaterThanOrEqual(3);
      expect((await proofSessionIds()).length).toBe((await sessions()).length);

      // Sign-out removes the session and, by cascade, its proof.
      const idOfA = (await currentSession(spike, a.jar))?.session.id;
      const out = await spike.api.signOut({ headers: a.jar.headers(), asResponse: true });

      expect(out.status).toBe(200);
      expect(await currentSession(spike, a.jar)).toBeNull();
      expect(await proofSessionIds()).not.toContain(idOfA);

      // "Sign out everywhere" (revokeSessions) ends every session; no proof is left.
      const all = await spike.api.revokeSessions({ headers: b.jar.headers(), asResponse: true });

      expect(all.status).toBe(200);
      expect(await currentSession(spike, b.jar)).toBeNull();
      expect(await currentSession(spike, c.jar)).toBeNull();
      expect(await sessions()).toHaveLength(0);
      expect(await proofSessionIds()).toEqual([]);

      // The cleanup of expired sessions (#84) takes the proof along.
      const d = await fullSignIn(spike, setup.uri);

      expect(d.step2.response.status).toBe(200);
      expect(await proofSessionIds()).toHaveLength(1);
      await orm.em.execute(`update auth.sessions set expires_at = now() - interval '1 minute'`);
      expect(await deleteExpiredSessions(pool)).toBe(1);
      expect(await proofSessionIds()).toEqual([]);
    });

    it("`trustDevice` skips the second step on the next password sign-in, so only the proof can gate admin access (step 6)", async () => {
      const { setup } = await adminWithTotp(spike);

      await orm.em.execute(`delete from auth.sessions`);
      const jar = new Jar();

      await signIn(spike, jar);
      const trusted = await verifyTotp(spike, jar, totp(setup.uri), true);

      expect(trusted.response.status).toBe(200);
      expect(jar.has("trust_device")).toBe(true);

      jar.absorb(await spike.api.signOut({ headers: jar.headers(), asResponse: true }));
      await orm.em.execute(`delete from auth.spike_mfa_proofs`);

      const next = await signIn(spike, jar);

      // A normal session with `twoFactorEnabled` true and no second step at all:
      // the proof table stays empty, so our check (no proof -> mfa_required) holds.
      expect(next.response.status).toBe(200);
      expect(next.body.twoFactorRedirect).toBeUndefined();
      expect(await sessions()).toHaveLength(1);
      expect(await proofSessionIds()).toEqual([]);
    });

    it("a refusal in the hook is too late for /two-factor/disable: TOTP is already off (step 5)", async () => {
      const { jar } = await adminWithTotp(spike);
      const response = await spike.api.disableTwoFactor({
        body: { password: PASSWORD },
        headers: jar.headers(),
        asResponse: true,
      });

      // Our policy does not list the path, so the new session is refused...
      expect(response.status).toBe(403);
      // ...after the plugin switched TOTP off and dropped the secret.
      expect(await userFlags()).toMatchObject({ enabled: false, factor: undefined });
    });

    it("refuses an admin session on a verify path unless TOTP is on or a session of the same account is present", async () => {
      const context = {
        path: "/two-factor/verify-totp",
        context: { internalAdapter: (await spike.$context).internalAdapter, session: null },
      };
      const before = createSpikeHooks(createProductionHooks()).session?.create?.before;
      const session = {
        userId: adminId,
        token: "t",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * HOUR_MS),
      };

      // No TOTP on the account and no session: refused like today.
      await expect(before?.(session as never, context as never)).rejects.toMatchObject({
        body: { message: "staff_password_only" },
      });
      // Other paths stay password-only, TOTP or not.
      await orm.em.execute(`update auth.users set two_factor_enabled = true`);
      await expect(
        before?.(session as never, { ...context, path: "/sign-in/email-otp" } as never),
      ).rejects.toMatchObject({ body: { message: "staff_password_only" } });
      // With TOTP on, the challenge path is allowed and cut to 12 hours.
      const allowed = (await before?.(session as never, context as never)) as {
        data: { expiresAt: Date };
      };

      expect(allowed.data.expiresAt.getTime() - session.createdAt.getTime()).toBe(12 * HOUR_MS);
    });
  });

  // ------------------------------------------------------- data isolation

  describe("the tables of the plugin", () => {
    it("are closed to krajozbior_app and krajozbior_ops, and the plugin never returns the secret", async () => {
      for (const role of ["krajozbior_app", "krajozbior_ops"] as const) {
        for (const table of ["auth.two_factors", "auth.spike_mfa_proofs"]) {
          await withClient(db.urls[role], async (client) => {
            await expect(client.query(`select 1 from ${table}`)).rejects.toMatchObject({
              code: "42501",
            });
          });
        }
      }

      const { jar, setup } = await adminWithTotp(spike);
      const [stored] = await orm.em.execute<{ secret: string; backup_codes: string }[]>(
        `select secret, backup_codes from auth.two_factors`,
      );

      // Stored encrypted: the plain backup codes and the secret are not in the row.
      expect(stored?.backup_codes).not.toContain(setup.backupCodes[0]);
      expect(stored?.secret).not.toBe(new URL(setup.uri).searchParams.get("secret"));
      expect(JSON.stringify((await currentSession(spike, jar))?.user)).not.toContain("secret");
    });
  });
});
