import { getMigrationEnv } from "./src/lib/config/env";
import { createOrmConfig } from "./src/lib/db/config";

// Read by the MikroORM CLI (`npm run db:migrate`), which connects as the owner
// role krajozbior_owner. The application uses the same config through
// src/lib/db/client.ts with DATABASE_URL (krajozbior_app).
export default createOrmConfig(getMigrationEnv().DATABASE_MIGRATION_URL);
