import "server-only";

import { getOrm } from "@/lib/db/client";

// Returns a boolean only. Driver errors can contain host names or credentials,
// so only the error class is logged.
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const orm = await getOrm();
    await orm.em.getConnection().execute("select 1");
    return true;
  } catch (error) {
    console.error(
      "Database health check failed:",
      error instanceof Error ? error.name : "unknown error",
    );
    return false;
  }
}
