import "server-only";

import type { Pool } from "pg";

// Sessions that expired are removed so the table keeps to the retention in the
// privacy policy (the login cookie lasts at most 30 days). Better Auth deletes
// an expired session only when that very token is presented, and its own
// cleanup of expired sign-in codes (verifications) already runs on every code
// lookup, so only sessions need this.
//
// One request removes at most this many rows, so a large backlog never slows
// a single sign-in code request; the next requests continue.
export const EXPIRED_SESSIONS_CLEANUP_BATCH = 100;
// The cleanup gives up after this long (a stuck lock must not hold a
// connection of the small krajozbior_auth pool).
const CLEANUP_STATEMENT_TIMEOUT = "1s";

/**
 * Deletes up to `limit` sessions whose `expires_at` has passed, as
 * krajozbior_auth (the only role with DELETE on auth.sessions). Returns how
 * many rows were removed. Throws on a database failure; the caller decides
 * that it must not block anything.
 */
export async function deleteExpiredSessions(
  pool: Pool,
  limit: number = EXPIRED_SESSIONS_CLEANUP_BATCH,
): Promise<number> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(`set local statement_timeout = '${CLEANUP_STATEMENT_TIMEOUT}'`);

    const { rowCount } = await client.query(
      `delete from auth.sessions where id in (
         select id from auth.sessions
          where expires_at < now()
          limit $1 for update skip locked)`,
      [limit],
    );

    await client.query("commit");

    return rowCount ?? 0;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
