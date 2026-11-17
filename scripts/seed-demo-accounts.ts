// Creates or resets the local demo accounts (two users and an admin).
// Local use only: refuses to run without the explicit flag ALLOW_DEMO_SEED=1,
// in production, or against a database that is not on localhost. The shared
// password comes from DEMO_ACCOUNT_PASSWORD and is never written to the
// repository or printed. Even when seeded somewhere by mistake, the demo
// accounts do not sign in on a production deployment (isDemoSignInAllowed).
//
// The accounts are created as starter_auth (DATABASE_AUTH_URL); the admin role
// is set as starter_owner (DATABASE_MIGRATION_URL), because starter_auth may
// not write the `role` column.
//
// Run with: ALLOW_DEMO_SEED=1 npm run db:seed:demo
import { closeAuth } from "../src/features/identity/infrastructure/better-auth";
import { seedDemoAccounts } from "../src/features/identity/infrastructure/demo-accounts";
import { ownerRoleAssigner } from "../src/features/identity/infrastructure/user-role";
import { assertLocalDatabaseUrl } from "../src/lib/config/loopback";

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "1") {
    throw new Error("Demo accounts are seeded only with ALLOW_DEMO_SEED=1 (local work and tests)");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo accounts must not be seeded in production");
  }

  // Before any connection: NODE_ENV alone does not say where the database is.
  assertLocalDatabaseUrl(process.env.DATABASE_AUTH_URL);
  assertLocalDatabaseUrl(process.env.DATABASE_MIGRATION_URL);

  try {
    const accounts = await seedDemoAccounts(
      process.env.DEMO_ACCOUNT_PASSWORD ?? "",
      ownerRoleAssigner(process.env.DATABASE_MIGRATION_URL as string),
    );

    for (const { email } of accounts) {
      console.log(`Demo account ready: ${email}`);
    }
  } finally {
    await closeAuth();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
