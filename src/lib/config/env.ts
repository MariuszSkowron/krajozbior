import "server-only";

import { z } from "zod";

import { isLoopbackHost } from "./loopback";

// Only server-side variables live here. Nothing in this file may be prefixed
// with NEXT_PUBLIC_, because the values would be inlined into the client bundle.
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

// DATABASE_URL is the web application's connection as the unprivileged role
// krajozbior_app (docs/data-isolation.md). It never points at the owner role.
const serverEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

// Authentication settings are validated separately from the database URL, so
// routes that only need the database (health, migrations) do not require them.
// DATABASE_AUTH_URL connects as krajozbior_auth, the only role allowed into `auth`.
const authEnvSchema = z.object({
  DATABASE_AUTH_URL: postgresUrl,
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }).optional(),
  // Header the trusted proxy sets with the client address. Without it the
  // sign-in limiter has no per-IP bucket.
  // Same values as ClientIpHeader in the identity domain; the typecheck of
  // getClientIpHeader() keeps the two in step.
  AUTH_CLIENT_IP_HEADER: z.enum(["x-real-ip", "cf-connecting-ip", "x-forwarded-for"]).optional(),
  // The daily limit of accepted sign-in code requests of the whole application
  // (otp-send-limits.ts); unset means the default.
  OTP_GLOBAL_DAILY_LIMIT: z
    .string()
    .regex(/^[1-9]\d{0,6}$/)
    .transform(Number)
    .optional(),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

// Read only by the MikroORM CLI: migrations run as krajozbior_owner.
const migrationEnvSchema = z.object({
  DATABASE_MIGRATION_URL: postgresUrl,
});

export type MigrationEnv = z.infer<typeof migrationEnvSchema>;

// The operator commands (`ops:curator`, `auth:create-admin`, the demo seed)
// connect as krajozbior_ops (D-21). Unlike the migration role, this one owns no
// table, so it cannot switch off the protection of the operations audit.
const opsEnvSchema = z.object({
  DATABASE_OPS_URL: postgresUrl,
});

export type OpsEnv = z.infer<typeof opsEnvSchema>;

export class ServerConfigError extends Error {
  constructor(invalidNames: string[]) {
    // Names only: values may be secrets and must not reach logs or responses.
    super(`Invalid server configuration: ${invalidNames.join(", ")}`);
    this.name = "ServerConfigError";
  }
}

function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  source: Record<string, string | undefined>,
): z.infer<Schema> {
  const result = schema.safeParse(source);

  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new ServerConfigError(names);
  }

  return result.data;
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return parseEnv(serverEnvSchema, source);
}

// In production the session cookie must be Secure: the public address is
// required and uses https, except on loopback, where a local production build
// (E2E) runs over plain http. A public address also needs the client-IP
// header, or the sign-in limiter would only count per account.
function productionAuthIssues(env: AuthEnv): string[] {
  const url = env.BETTER_AUTH_URL === undefined ? null : new URL(env.BETTER_AUTH_URL);
  const loopback = url !== null && isLoopbackHost(url.hostname);
  const issues: string[] = [];

  if (url === null || (url.protocol !== "https:" && !loopback)) {
    issues.push("BETTER_AUTH_URL");
  }

  if (url !== null && !loopback && env.AUTH_CLIENT_IP_HEADER === undefined) {
    issues.push("AUTH_CLIENT_IP_HEADER");
  }

  return issues;
}

export function parseAuthEnv(source: Record<string, string | undefined>): AuthEnv {
  const env = parseEnv(authEnvSchema, source);
  const issues = source.NODE_ENV === "production" ? productionAuthIssues(env) : [];

  if (issues.length > 0) {
    throw new ServerConfigError(issues);
  }

  return env;
}

export function parseMigrationEnv(source: Record<string, string | undefined>): MigrationEnv {
  return parseEnv(migrationEnvSchema, source);
}

export function parseOpsEnv(source: Record<string, string | undefined>): OpsEnv {
  return parseEnv(opsEnvSchema, source);
}

// The demo accounts (seeded with one shared, known password) may sign in only
// outside production, or in a production build of the tests: with the flag
// DEMO_ACCOUNTS_TEST_ONLY=1 of its own AND a loopback BETTER_AUTH_URL. On a
// shared or public deployment they never sign in, even if somebody seeded them.
export function isDemoSignInAllowed(source: Record<string, string | undefined>): boolean {
  if (source.NODE_ENV !== "production") {
    return true;
  }

  return source.DEMO_ACCOUNTS_TEST_ONLY === "1" && hasLoopbackAuthUrl(source);
}

function hasLoopbackAuthUrl(source: Record<string, string | undefined>): boolean {
  try {
    return (
      source.BETTER_AUTH_URL !== undefined &&
      isLoopbackHost(new URL(source.BETTER_AUTH_URL).hostname)
    );
  } catch {
    return false;
  }
}

// Outgoing e-mail (sign-in codes). `outbox` writes .eml files to a git-ignored
// directory and is for local work and tests; `memory` keeps messages in the
// process (integration tests). A production provider is not part of the
// krajozbior: add its adapter and transport when the project chooses one.
// The outbox directory must be a relative path inside `.data/` (git-ignored, not
// served by Next.js): no absolute paths, no `..`, no `public/`.
export function isSafeOutboxDir(value: string): boolean {
  if (value.includes("\0") || /^([a-zA-Z]:|[\\/])/.test(value)) {
    return false;
  }

  const segments = value.split(/[\\/]+/).filter((segment) => segment !== "" && segment !== ".");

  return segments.length >= 2 && segments[0] === ".data" && !segments.includes("..");
}

const emailEnvSchema = z.discriminatedUnion("EMAIL_TRANSPORT", [
  z.object({
    EMAIL_TRANSPORT: z.literal("outbox"),
    EMAIL_OUTBOX_DIR: z.string().min(1).refine(isSafeOutboxDir).default(".data/email-outbox"),
    EMAIL_FROM: z.email(),
  }),
  z.object({
    EMAIL_TRANSPORT: z.literal("memory"),
    EMAIL_FROM: z.email(),
  }),
]);

export type EmailEnv = z.infer<typeof emailEnvSchema>;

export const DEV_EMAIL_FROM = "noreply@krajozbior.local";

// The local transports may run in a production build only for the tests of the
// built application: with the flag EMAIL_OUTBOX_TEST_ONLY=1 of its own AND a
// loopback BETTER_AUTH_URL. A set but non-loopback address means a shared or
// public deployment, where they are always refused.
export function parseEmailEnv(source: Record<string, string | undefined>): EmailEnv {
  const production = source.NODE_ENV === "production";
  const env = parseEnv(emailEnvSchema, {
    ...source,
    EMAIL_TRANSPORT: source.EMAIL_TRANSPORT?.trim() || (production ? undefined : "outbox"),
    EMAIL_OUTBOX_DIR: source.EMAIL_OUTBOX_DIR?.trim() || undefined,
    EMAIL_FROM: source.EMAIL_FROM?.trim() || (production ? undefined : DEV_EMAIL_FROM),
  });

  const loopback = hasLoopbackAuthUrl(source);
  const publicUrl = source.BETTER_AUTH_URL !== undefined && !loopback;
  const productionWithoutConsent =
    production && !(source.EMAIL_OUTBOX_TEST_ONLY === "1" && loopback);

  if (publicUrl || productionWithoutConsent) {
    throw new ServerConfigError(["EMAIL_TRANSPORT"]);
  }

  return env;
}

export function getEmailEnv(): EmailEnv {
  return parseEmailEnv(process.env);
}

let cachedEnv: ServerEnv | undefined;

// Validated lazily: importing this module must not fail, so `next build` runs
// without a database or any configured secrets.
export function getServerEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv(process.env);
  return cachedEnv;
}

export function getAuthEnv(): AuthEnv {
  return parseAuthEnv(process.env);
}

export function getMigrationEnv(): MigrationEnv {
  return parseMigrationEnv(process.env);
}

export function getOpsEnv(): OpsEnv {
  return parseOpsEnv(process.env);
}
