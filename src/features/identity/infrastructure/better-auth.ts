import "server-only";

import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { PostgresDialect } from "kysely";
import { Pool, type PoolConfig } from "pg";

import { getAuthEnv } from "@/lib/config/env";
import { assertSafeDatabaseRole } from "@/lib/db/role-guard";
import { getEmailSender } from "@/lib/email/create-email-sender";
import { SIGN_IN_CODE_VALIDITY_MINUTES } from "@/lib/email/sign-in-code-email";

import { isRole, type Actor } from "../domain/actor";
import type {
  CodeCredentials,
  Credentials,
  IdentityProvider,
  SignInResult,
} from "../domain/identity-provider";
import { SESSION_LIMIT_MS } from "../domain/session-policy";
import { createDatabaseHooks, createSendSignInCode } from "./auth-hooks";
import { deleteAccountRows } from "./delete-account-rows";

// The longest session any role may have; the database hooks cut it per role.
const SESSION_LIFETIME_SECONDS = Math.max(...Object.values(SESSION_LIMIT_MS)) / 1000;

// Maps Better Auth's camelCase fields to the snake_case columns of the migration.
const snake = (...names: string[]) =>
  Object.fromEntries(
    names.map((name) => [name, name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)]),
  );

// Kysely opens the pool through this factory before the first query and
// retries it after a failure, so a krajozbior_auth connection that reaches a role
// able to skip row policies never serves a request.
export function verifiedPool(pool: Pool): () => Promise<Pool> {
  return async () => {
    await assertSafeDatabaseRole(async (sql) => (await pool.query(sql)).rows[0]);
    return pool;
  };
}

// Links in the sign-in code e-mail when no public address is configured (local work).
const LOCAL_SITE_URL = "http://localhost:3000";

// Better Auth owns the `auth` schema (users, sessions, accounts, verifications;
// created by migration) and reaches it through its own pool as krajozbior_auth, a
// role with no access to application tables (docs/data-isolation.md). Password
// sign-up is off: admin and demo accounts come from the seed. A `user` account
// is created by the sign-in code, only through our routes in `src/app/api/auth`
// and the database hooks, which force the role `user`. Better Auth's own
// catch-all HTTP router is deliberately not mounted.
function createAuth(pool: Pool, secret: string, baseURL?: string) {
  return betterAuth({
    secret,
    baseURL,
    telemetry: { enabled: false },
    database: {
      dialect: new PostgresDialect({ pool: verifiedPool(pool) }),
      type: "postgres",
      schemaName: "auth",
    },
    emailAndPassword: { enabled: true, disableSignUp: true, autoSignIn: false },
    user: {
      modelName: "users",
      fields: snake("emailVerified", "createdAt", "updatedAt"),
      additionalFields: {
        // `input: false` keeps clients from setting their own role. No
        // default here: Better Auth would then write the column, and
        // krajozbior_auth may insert accounts only without `role` (the database
        // default `user` applies; another role is set by user-role.ts).
        role: { type: "string", required: false, input: false },
      },
    },
    session: {
      modelName: "sessions",
      fields: snake("expiresAt", "createdAt", "updatedAt", "ipAddress", "userAgent", "userId"),
      expiresIn: SESSION_LIFETIME_SECONDS,
      // Absolute lifetime: reading a session never extends it. Refreshing only
      // in the database, without a new cookie, would keep a stolen token used
      // regularly valid forever.
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
    databaseHooks: createDatabaseHooks(),
    plugins: [
      // Sign-in code: six digits, valid for 10 minutes, five attempts, stored
      // encrypted; asking again within the validity sends the same code, so
      // somebody else's request does not invalidate the code a person has.
      emailOTP({
        otpLength: 6,
        expiresIn: SIGN_IN_CODE_VALIDITY_MINUTES * 60,
        allowedAttempts: 5,
        storeOTP: "encrypted",
        resendStrategy: "reuse",
        disableSignUp: false,
        sendVerificationOTP: createSendSignInCode({
          emailSender: getEmailSender,
          siteUrl: () => baseURL ?? LOCAL_SITE_URL,
        }),
      }),
    ],
    advanced: {
      cookiePrefix: "krajozbior",
      // The client address is not stored with a session.
      ipAddress: { disableIpTracking: true },
      // Secure follows the configured address, not the library's guess;
      // parseAuthEnv already requires https for a public production address.
      ...(baseURL === undefined
        ? {}
        : { useSecureCookies: new URL(baseURL).protocol === "https:" }),
      database: { generateId: "uuid" },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let authInstance: Auth | undefined;
let authPool: Pool | undefined;

/**
 * How long a request waits for one of the pool's connections (SEC-3). The server has no
 * request limit per address, so a flood of sign-in requests ends in 503 after this time
 * instead of leaving every later request (sessions on all pages) waiting without end.
 */
export const AUTH_POOL_CONNECTION_TIMEOUT_MS = 5000;

export function authPoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: 5,
    connectionTimeoutMillis: AUTH_POOL_CONNECTION_TIMEOUT_MS,
  };
}

// Created lazily so importing this module (and `next build`) needs no secrets.
export function getAuth(): Auth {
  if (authInstance === undefined) {
    const { DATABASE_AUTH_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL } = getAuthEnv();
    authPool = new Pool(authPoolConfig(DATABASE_AUTH_URL));
    authInstance = createAuth(authPool, BETTER_AUTH_SECRET, BETTER_AUTH_URL);
  }

  return authInstance;
}

let verifiedAuthPool: Promise<Pool> | undefined;

// The adapter's pool for its own tables in `auth` (the sign-in throttle),
// checked by the same role guard before first use; a failed check is retried.
export function getAuthPool(): Promise<Pool> {
  getAuth();

  verifiedAuthPool ??= verifiedPool(authPool as Pool)().catch((error: unknown) => {
    verifiedAuthPool = undefined;
    throw error;
  });

  return verifiedAuthPool;
}

// Releases the connection pool; scripts and integration tests call it to exit.
export async function closeAuth(): Promise<void> {
  const pool = authPool;

  authInstance = undefined;
  authPool = undefined;
  verifiedAuthPool = undefined;
  await pool?.end();
}

function toActor(user: { id: string; role?: unknown } | null | undefined): Actor | null {
  if (!user || !isRole(user.role)) {
    return null;
  }

  return { id: user.id, role: user.role };
}

// 4xx means rejected credentials; anything else is a provider failure and must
// surface as an error rather than as "wrong password".
async function toSignInResult(response: Response): Promise<SignInResult | null> {
  if (response.status >= 400 && response.status < 500) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Sign-in failed with status ${response.status}`);
  }

  const body = (await response.json()) as { user?: { id: string; role?: unknown } };
  const actor = toActor(body.user);

  if (actor === null) {
    throw new Error("Sign-in response did not contain a valid actor");
  }

  return { actor, setCookies: response.headers.getSetCookie() };
}

export class BetterAuthIdentityProvider implements IdentityProvider {
  constructor(private readonly auth: () => Auth = getAuth) {}

  async getActor(headers: Headers): Promise<Actor | null> {
    const session = await this.auth().api.getSession({ headers });

    return toActor(session?.user);
  }

  async signIn(credentials: Credentials, headers: Headers): Promise<SignInResult | null> {
    const response = await this.auth().api.signInEmail({
      body: { email: credentials.email, password: credentials.password },
      headers,
      asResponse: true,
    });

    return toSignInResult(response);
  }

  async requestSignInCode(email: string, headers: Headers): Promise<void> {
    await this.auth().api.sendVerificationOTP({ body: { email, type: "sign-in" }, headers });
  }

  async signInWithCode(
    credentials: CodeCredentials,
    headers: Headers,
  ): Promise<SignInResult | null> {
    const response = await this.auth().api.signInEmailOTP({
      body: { email: credentials.email, otp: credentials.code },
      headers,
      asResponse: true,
    });

    return toSignInResult(response);
  }

  async getSessionCreatedAt(headers: Headers): Promise<Date | null> {
    const session = await this.auth().api.getSession({ headers });

    return session ? new Date(session.session.createdAt) : null;
  }

  async deleteAccount(accountId: string): Promise<boolean> {
    return deleteAccountRows(await getAuthPool(), accountId);
  }

  async signOut(headers: Headers): Promise<string[]> {
    const { api } = this.auth();
    const hadSession = (await api.getSession({ headers })) !== null;
    let cookies: string[] = [];

    try {
      cookies = (await api.signOut({ headers, asResponse: true })).headers.getSetCookie();
    } catch {
      // Signing out without a valid session must still succeed.
    }

    // Better Auth swallows session-deletion errors and still clears the cookie,
    // so confirm the session is really gone before reporting success.
    if (hadSession && (await api.getSession({ headers })) !== null) {
      throw new Error("Session is still active after sign-out");
    }

    return cookies;
  }
}
