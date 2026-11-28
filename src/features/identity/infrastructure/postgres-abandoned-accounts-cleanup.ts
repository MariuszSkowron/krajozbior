import "server-only";

import type { Pool } from "pg";

import { deleteAccountRows } from "./delete-account-rows";

// Privacy policy 1.1 (section 9) and the terms (chapter 4, point 2): an account on which the terms
// were never accepted (an abandoned sign-up) is deleted after 7 days. The same deletion path as
// the person's own deletion (cascade, audit entry written by the database), guarded again in the
// database by `auth_account_is_abandoned` (role `user`, no organization, no acceptance, age).
export const ABANDONED_ACCOUNT_DAYS = 7;
export const ABANDONED_ACCOUNTS_BATCH = 20;

/**
 * Deletes up to `limit` abandoned accounts older than `days`, as krajozbior_auth. Returns how many
 * were removed. The candidates are found by role and age; the database function decides which of
 * them really have no acceptance and no organization, and the deletion checks it again under the
 * row lock. Throws on a database failure; the caller decides that it must not block anything.
 */
export async function deleteAbandonedAccounts(
  pool: Pool,
  days: number = ABANDONED_ACCOUNT_DAYS,
  limit: number = ABANDONED_ACCOUNTS_BATCH,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `select u.id
       from auth.users u
      where u.role = 'user'
        and u.created_at <= now() - make_interval(days => $1::int)
        and public.auth_account_is_abandoned(u.id, make_interval(days => $1::int))
      order by u.created_at
      limit $2`,
    [days, limit],
  );
  let removed = 0;

  for (const row of rows) {
    if (await deleteAccountRows(pool, row.id, { onlyAbandonedOlderThanDays: days })) {
      removed += 1;
    }
  }

  return removed;
}
