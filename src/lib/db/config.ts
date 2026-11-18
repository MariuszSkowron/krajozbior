import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, PostgreSqlDriver } from "@mikro-orm/postgresql";

import { getServerEnv } from "@/lib/config/env";

// Shared by the application (DATABASE_URL, krajozbior_app) and the MikroORM CLI
// (root `mikro-orm.config.ts`, DATABASE_MIGRATION_URL, krajozbior_owner), so both
// use the same migrations folder.
export function createOrmConfig(databaseUrl = getServerEnv().DATABASE_URL) {
  return defineConfig({
    driver: PostgreSqlDriver,
    clientUrl: databaseUrl,
    entities: [],
    // Schema is managed by SQL migrations; there are no ORM entities yet.
    discovery: { warnWhenNoEntities: false },
    extensions: [Migrator],
    migrations: {
      path: "src/lib/db/migrations",
      pathTs: "src/lib/db/migrations",
      glob: "!(*.d).{js,ts}",
    },
    debug: false,
  });
}
