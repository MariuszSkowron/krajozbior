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
  // The share of that limit for addresses without an account (default 100);
  // accounts get the rest. A value not below the total makes one shared pool.
  OTP_NEW_ACCOUNT_DAILY_LIMIT: z
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

// Directory of the photo volume (E4, spec 5.11.1). Optional, and a wrong state never stops the
// application: see mediaRootWarning().
const mediaEnvSchema = z.object({
  MEDIA_ROOT: z
    .string()
    .refine((value) => value.startsWith("/") && !value.includes("\0") && !value.includes(".."))
    .optional(),
});

export type MediaEnv = z.infer<typeof mediaEnvSchema>;

// The switch of reports of a problem with a place (P4b, spec Q3): off unless it says "true". It
// closes the whole road of collecting the data (the form, the route, "Moje zgłoszenia"), so it
// is read on its own and a missing or wrong value never breaks the rest of the configuration.
const placeReportsEnvSchema = z.object({
  FEATURE_PLACE_REPORTS: z.enum(["true", "false"]).optional(),
});

export type PlaceReportsEnv = z.infer<typeof placeReportsEnvSchema>;

export function parsePlaceReportsEnv(source: Record<string, string | undefined>): PlaceReportsEnv {
  return parseEnv(placeReportsEnvSchema, {
    FEATURE_PLACE_REPORTS: source.FEATURE_PLACE_REPORTS?.trim() || undefined,
  });
}

// True only for the exact value "true". A wrong value counts as off (it is a switch of personal
// data collection: when in doubt, nothing is collected).
export function isPlaceReportsEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  try {
    return parsePlaceReportsEnv(source).FEATURE_PLACE_REPORTS === "true";
  } catch (error) {
    if (error instanceof ServerConfigError) {
      return false;
    }

    throw error;
  }
}

export class ServerConfigError extends Error {
  constructor(readonly invalidNames: string[]) {
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

export function parseMediaEnv(source: Record<string, string | undefined>): MediaEnv {
  return parseEnv(mediaEnvSchema, { MEDIA_ROOT: source.MEDIA_ROOT?.trim() || undefined });
}

// What the startup check found in the directory of the photo volume.
export type MediaRootState = "ok" | "missing" | "not-directory" | "unreadable" | "wrong-owner";

// In the Commons phases (before E4-1) a wrong MEDIA_ROOT must NOT stop the server: a volume with
// the wrong owner would otherwise roll back the whole deployment. The caller logs the returned line
// (one line, no path or value) and starts anyway; `/media` then answers 404. Returns null when
// MEDIA_ROOT is unset or the directory is fine. The caller supplies the inspection (the file system
// lives in instrumentation-node.ts, so this module stays free of `node:fs`).
export function mediaRootWarning(
  source: Record<string, string | undefined>,
  inspect: (directory: string) => MediaRootState,
): string | null {
  let root: string | undefined;

  try {
    root = parseMediaEnv(source).MEDIA_ROOT;
  } catch (error) {
    if (!(error instanceof ServerConfigError)) {
      throw error;
    }

    return "Warning: MEDIA_ROOT is not an absolute path; photos are unavailable (the server starts).";
  }

  if (root === undefined) {
    return null;
  }

  const state = inspect(root);

  return state === "ok"
    ? null
    : `Warning: MEDIA_ROOT is not usable (${state}); photos are unavailable (the server starts).`;
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

// Outgoing e-mail (sign-in codes). `brevo` sends through the Brevo HTTP API and
// is the only transport of a shared or public deployment (D-E11-9); `outbox`
// writes .eml files to a git-ignored directory and is for local work and tests;
// `memory` keeps messages in the process (integration tests).
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
  z.object({
    EMAIL_TRANSPORT: z.literal("brevo"),
    // Printable ASCII without spaces (it goes into a request header); the real
    // keys are much longer than the minimum.
    BREVO_API_KEY: z.string().regex(/^[\x21-\x7e]{16,512}$/),
    EMAIL_FROM: z.email(),
  }),
]);

export type EmailEnv = z.infer<typeof emailEnvSchema>;

export const DEV_EMAIL_FROM = "noreply@krajozbior.local";

// The local transports may run in a production build only for the tests of the
// built application: with the flag EMAIL_OUTBOX_TEST_ONLY=1 of its own AND a
// loopback BETTER_AUTH_URL. A set but non-loopback address means a shared or
// public deployment, where they are always refused. `brevo` needs its own key
// and an explicit sender address everywhere, never the local default.
export function parseEmailEnv(source: Record<string, string | undefined>): EmailEnv {
  const production = source.NODE_ENV === "production";
  const transport = source.EMAIL_TRANSPORT?.trim() || (production ? undefined : "outbox");
  const defaultFrom = production || transport === "brevo" ? undefined : DEV_EMAIL_FROM;
  const env = parseEnv(emailEnvSchema, {
    ...source,
    EMAIL_TRANSPORT: transport,
    EMAIL_OUTBOX_DIR: source.EMAIL_OUTBOX_DIR?.trim() || undefined,
    BREVO_API_KEY: source.BREVO_API_KEY?.trim() || undefined,
    EMAIL_FROM: source.EMAIL_FROM?.trim() || defaultFrom,
  });

  if (env.EMAIL_TRANSPORT === "brevo") {
    return env;
  }

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

// Run once when a production server starts (src/instrumentation.ts): the
// settings of the web application (database, sign-in, e-mail) are checked all at
// once, so a server with a missing or wrong value does not start, instead of
// failing on the first sign-in. Outside production nothing is checked here
// (development and `next build` need no configuration); the lazy getters still
// validate on use. The error names every wrong variable, never a value.
export function assertStartupConfig(source: Record<string, string | undefined>): void {
  if (source.NODE_ENV !== "production") {
    return;
  }

  const names = new Set<string>();

  for (const parse of [parseServerEnv, parseAuthEnv, parseEmailEnv]) {
    try {
      parse(source);
    } catch (error) {
      if (!(error instanceof ServerConfigError)) {
        throw error;
      }
      for (const name of error.invalidNames) names.add(name);
    }
  }

  if (names.size > 0) {
    throw new ServerConfigError([...names]);
  }
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
