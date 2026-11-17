// Creates an administrator account, or resets its password and role. The web
// application cannot do this: its identity role (starter_auth) may not write
// the `role` column. The account and its password are written as starter_auth
// (DATABASE_AUTH_URL), the role as starter_owner (DATABASE_MIGRATION_URL).
// Existing sessions of the account end.
//
// The password comes from ADMIN_PASSWORD (min. 16 characters) and is never
// printed or stored in clear text. Run it on the machine that has the
// production configuration, then remove ADMIN_PASSWORD from the environment.
//
// Run with: npm run auth:create-admin -- --email admin@example.com [--name "Jan Kowalski"]
import { parseArgs } from "node:util";

import { z } from "zod";

import { closeAuth } from "../src/features/identity/infrastructure/better-auth";
import { ensurePasswordAccount } from "../src/features/identity/infrastructure/demo-accounts";
import { ownerRoleAssigner } from "../src/features/identity/infrastructure/user-role";
import { getMigrationEnv } from "../src/lib/config/env";

const ADMIN_PASSWORD_MIN_LENGTH = 16;

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" } },
  });
  const email = z.email().max(254).safeParse(values.email?.trim().toLowerCase());

  if (!email.success) {
    throw new Error("Usage: auth:create-admin -- --email <e-mail> [--name <name>]");
  }

  const password = process.env.ADMIN_PASSWORD ?? "";

  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must have at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`);
  }

  try {
    await ensurePasswordAccount(email.data, values.name ?? "Administrator", password);
    await ownerRoleAssigner(getMigrationEnv().DATABASE_MIGRATION_URL)(email.data, "admin");
    console.log("Administrator account ready");
  } finally {
    await closeAuth();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
