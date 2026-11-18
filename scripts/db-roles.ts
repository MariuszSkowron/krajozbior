// Creates or updates the database roles krajozbior_owner, krajozbior_app, krajozbior_auth and
// krajozbior_ops (issue #21) and prepares the database for migrations run as
// krajozbior_owner. Connects through DATABASE_ADMIN_URL (a superuser; locally the
// `krajozbior` user from compose.yaml). Passwords come from KRAJOZBIOR_*_DB_PASSWORD and
// are never printed.
//
// Run with: npm run db:roles (before npm run db:migrate)
import { Client } from "pg";
import { z } from "zod";

import { databaseRoles, provisionDatabaseRoles, readRolePasswords } from "../src/lib/db/roles";

async function main() {
  const adminUrl = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env.DATABASE_ADMIN_URL);

  if (!adminUrl.success) {
    throw new Error("Invalid server configuration: DATABASE_ADMIN_URL");
  }

  const passwords = readRolePasswords(process.env);
  const client = new Client({ connectionString: adminUrl.data });

  await client.connect();

  try {
    await provisionDatabaseRoles(client, passwords);
    console.log(`Database roles ready: ${databaseRoles.join(", ")}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  // The driver message names objects, never passwords or the connection URL.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
