// Operator procedure: deletes accounts on which the terms were never accepted and that are older
// than 7 days (privacy policy 1.1, section 9). The same pass the web application runs at most once
// an hour when someone asks for a sign-in code; this command is for a timer or for running by hand.
// Connects as krajozbior_auth through DATABASE_AUTH_URL; prints only the number of removed accounts.
//
// Run with: npm run auth:cleanup-abandoned
import { closeAuth, getAuthPool } from "../src/features/identity/infrastructure/better-auth";
import { deleteAbandonedAccounts } from "../src/features/identity/infrastructure/postgres-abandoned-accounts-cleanup";

async function main() {
  const pool = await getAuthPool();
  let total = 0;
  let removed: number;

  // The pass removes a bounded batch; repeat until nothing is left.
  do {
    removed = await deleteAbandonedAccounts(pool);
    total += removed;
  } while (removed > 0);

  console.log(`Removed abandoned accounts: ${total}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Cleanup failed");
    process.exitCode = 1;
  })
  .finally(() => closeAuth());
