// Creates or resets the local demo accounts (two users, an admin and two
// curators) and the demo organizations the curators belong to.
// Local use only: refuses to run without the explicit flag ALLOW_DEMO_SEED=1,
// in production, or against a database that is not on localhost. The shared
// password comes from DEMO_ACCOUNT_PASSWORD and is never written to the
// repository or printed. Even when seeded somewhere by mistake, the demo
// accounts do not sign in on a production deployment (isDemoSignInAllowed).
//
// The accounts are created as krajozbior_auth (DATABASE_AUTH_URL); the roles, the
// organizations and the curator lookup go through krajozbior_ops
// (DATABASE_OPS_URL), because krajozbior_auth may not write the `role` column.
// The seed does not need the migration password (D-21).
//
// Run with: ALLOW_DEMO_SEED=1 npm run db:seed:demo
import { closeAuth } from "../src/features/identity/infrastructure/better-auth";
import { seedDemoAccounts } from "../src/features/identity/infrastructure/demo-accounts";
import { opsRoleAssigner } from "../src/features/identity/infrastructure/user-role";
import {
  DEMO_COLLECTION_TITLE,
  seedDemoCatalog,
} from "../src/features/catalog/infrastructure/seed-demo-catalog";
import { DEMO_EMAIL_DOMAIN } from "../src/features/identity/domain/demo-account-list";
import { seedDemoNews } from "../src/features/news/infrastructure/seed-demo-news";
import { seedDemoReports } from "../src/features/reports/infrastructure/seed-demo-reports";
import {
  assertDemoOrganizationsSeeded,
  demoOrganizations,
  seedDemoOrganizations,
} from "../src/features/organizations/infrastructure/seed-demo-organizations";
import { getOpsEnv } from "../src/lib/config/env";
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
  // A missing DATABASE_OPS_URL ends the seed here, naming the variable.
  assertLocalDatabaseUrl(getOpsEnv().DATABASE_OPS_URL);
  assertLocalDatabaseUrl(process.env.DATABASE_URL);

  try {
    const accounts = await seedDemoAccounts(
      process.env.DEMO_ACCOUNT_PASSWORD ?? "",
      opsRoleAssigner(process.env.DATABASE_OPS_URL as string),
    );

    for (const { email } of accounts) {
      console.log(`Demo account ready: ${email}`);
    }

    // The identity area does not import organizations; the script wires them.
    const organizations = await seedDemoOrganizations(process.env.DATABASE_OPS_URL as string);

    for (const { organizationSlug, outcome } of organizations) {
      console.log(`Demo organization ${organizationSlug}: ${outcome}`);
    }

    // A refused grant ends the script with a non-zero code (main's catch).
    assertDemoOrganizationsSeeded(organizations);

    // One published sample collection of the first demo organization, made
    // through the curator use cases as krajozbior_app (needs DATABASE_URL).
    const sampleCurator = demoOrganizations[0]!.curatorEmail;
    const sample = await seedDemoCatalog(
      process.env.DATABASE_URL as string,
      process.env.DATABASE_OPS_URL as string,
      sampleCurator,
    );

    console.log(`Demo collection "${DEMO_COLLECTION_TITLE}": ${sample}`);

    // Three sample reports of a problem with the places of the sample collection (two waiting,
    // one rejected), so a demo curator has a queue. Refused where the demo accounts may not sign in.
    const reports = await seedDemoReports(
      process.env.DATABASE_URL as string,
      process.env.DATABASE_OPS_URL as string,
      `user@${DEMO_EMAIL_DOMAIN}`,
      sampleCurator,
    );

    console.log(`Demo reports: ${reports}`);

    // The editorial organization and three demo news, through the writer of `news:import`.
    const news = await seedDemoNews(process.env.DATABASE_OPS_URL as string);

    console.log(`Demo news: ${JSON.stringify(news)}`);
  } finally {
    await closeAuth();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
