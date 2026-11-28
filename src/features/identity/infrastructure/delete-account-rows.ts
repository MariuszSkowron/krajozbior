import "server-only";

import type { Pool } from "pg";

import { SoleOrganizationMemberError } from "../domain/identity-provider";

// Identifiers Better Auth's e-mail code plugin stores in `auth.verifications`
// for an address: `<type>-otp-<e-mail>` (and `change-email-otp-<id>:<new e-mail>`).
const CODE_TYPES = ["sign-in", "email-verification", "forget-password"] as const;

export type DeleteAccountOptions = Readonly<{
  /**
   * Delete only when the account never accepted any version of the terms, has the plain role and
   * no organization, and is at least this many days old (0 = any age). Otherwise nothing is
   * deleted and the result is false (privacy policy 1.1, section 9).
   */
  onlyAbandonedOlderThanDays?: number;
}>;

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
 * Throws SoleOrganizationMemberError when the BEFORE DELETE trigger refuses to
 * leave an organization without a member (Q8; atomic with the deletion).
 */
export async function deleteAccountRows(
  pool: Pool,
  accountId: string,
  options: DeleteAccountOptions = {},
): Promise<boolean> {
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

    // Only an account that never accepted the terms, has no other role and is old enough goes
    // (the guard of the database, read under the row lock, so an acceptance that is being
    // written at this moment either shows up here or fails on the foreign key afterwards).
    if (options.onlyAbandonedOlderThanDays !== undefined) {
      const { rows: guard } = await client.query<{ abandoned: boolean }>(
        `select public.auth_account_is_abandoned($1::uuid, make_interval(days => $2::int)) as abandoned`,
        [accountId, options.onlyAbandonedOlderThanDays],
      );

      if (guard[0]?.abandoned !== true) {
        await client.query("rollback");

        return false;
      }
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

    // The guard trigger refused to leave an organization without a member.
    if (error instanceof Error && error.message === "sole_organization_member") {
      throw new SoleOrganizationMemberError();
    }

    throw error;
  } finally {
    client.release();
  }
}
