import "server-only";

import type { Pool } from "pg";

// Identifiers Better Auth's e-mail code plugin stores in `auth.verifications`
// for an address: `<type>-otp-<e-mail>` (and `change-email-otp-<id>:<new e-mail>`).
const CODE_TYPES = ["sign-in", "email-verification", "forget-password"] as const;

/**
 * Deletes one account as krajozbior_auth, in one transaction (E9-5, D-E9-3):
 *
 * 1. locks the account row and reads its e-mail (needed only to find the codes);
 * 2. deletes the sign-in codes of that address and the action limits of the
 *    account (`action:<name>:<id>` in `auth.sign_in_throttle`);
 * 3. deletes the `auth.users` row. Foreign keys cascade to sessions, login
 *    accounts and every row of the product; the AFTER DELETE trigger of the
 *    database writes the `delete_account` entry of the audit in the same
 *    transaction. This function writes nothing to the audit and the role has no
 *    privilege to.
 *
 * The limit counters keyed by an HMAC of the address stay until they expire
 * (D-E9-3). Returns false when the account was already gone (idempotent). A
 * visit saved concurrently either commits first (and is cascaded away) or fails
 * on the foreign key: the row lock conflicts with the key-share lock of the check.
 */
export async function deleteAccountRows(pool: Pool, accountId: string): Promise<boolean> {
  const client = await pool.connect();

  try {
    await client.query("begin");

    const { rows } = await client.query<{ email: string }>(
      `select email from auth.users where id = $1::uuid for update`,
      [accountId],
    );

    if (rows.length === 0) {
      await client.query("rollback");

      return false;
    }

    const email = rows[0].email;

    await client.query(
      `delete from auth.verifications
        where identifier = any($1::text[])
           or identifier like $2`,
      [CODE_TYPES.map((type) => `${type}-otp-${email}`), `change-email-otp-${accountId}:%`],
    );
    await client.query(`delete from auth.sign_in_throttle where key like $1`, [
      `action:%:${accountId}`,
    ]);
    await client.query(`delete from auth.users where id = $1::uuid`, [accountId]);
    await client.query("commit");

    return true;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
