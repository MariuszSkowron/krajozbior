// Creates an administrator account, or resets its password and role. The web
// application cannot do this: its identity role (krajozbior_auth) may not write
// the `role` column. The account and its password are written as krajozbior_auth
// (DATABASE_AUTH_URL), the role as krajozbior_ops (DATABASE_OPS_URL; D-21), which
// leaves a `set_user_role` entry with the reason in the operations audit: the
// database refuses a role change without it. Existing sessions of the account end.
//
// --reason is required (why this account becomes an administrator); --operator
// is a declared label (default: $USERNAME / $USER), like in `npm run ops:curator`.
// Both are checked before anything is written.
//
// The password comes from ADMIN_PASSWORD (min. 16 characters) and is never
// printed or stored in clear text. Run it on the machine that has the
// production configuration, then remove ADMIN_PASSWORD from the environment.
//
// Run with: npm run auth:create-admin -- --email admin@example.com --reason "<reason>" [--name "Jan Kowalski"] [--operator <label>]
import { parseCreateAdminArgs } from "../src/features/identity/application/create-admin-args";
import { closeAuth } from "../src/features/identity/infrastructure/better-auth";
import { ensurePasswordAccount } from "../src/features/identity/infrastructure/demo-accounts";
import { opsRoleAssigner } from "../src/features/identity/infrastructure/user-role";
import { getOpsEnv } from "../src/lib/config/env";

const ADMIN_PASSWORD_MIN_LENGTH = 16;

async function main() {
  const parsed = parseCreateAdminArgs(
    process.argv.slice(2),
    process.env.USERNAME ?? process.env.USER,
  );

  if (!parsed.ok) {
    throw new Error(parsed.message);
  }

  const { email, name, operator, reason } = parsed.args;
  const password = process.env.ADMIN_PASSWORD ?? "";

  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must have at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`);
  }

  // Before the account is touched: a missing DATABASE_OPS_URL ends the command here.
  const assignRole = opsRoleAssigner(getOpsEnv().DATABASE_OPS_URL);

  try {
    await ensurePasswordAccount(email, name ?? "Administrator", password);

    const assigned = await assignRole(email, "admin", { operator, reason });

    if (assigned.outcome === "rejected") {
      throw new Error("The role was refused: the account is missing");
    }

    console.log("Administrator account ready");
  } finally {
    await closeAuth();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
