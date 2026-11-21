import "server-only";

import { createHmac, hkdfSync } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import {
  decide,
  normalizeEmail,
  SIGN_IN_WINDOW_SECONDS,
  type BucketState,
  type SignInThrottle,
  type ThrottleDecision,
  type ThrottleScope,
  type ThrottleSubject,
} from "../domain/sign-in-throttle";

// Rows with an ended window and no active block that one reservation removes,
// so the table stays bounded by the attempts of one window.
const CLEANUP_BATCH = 100;
// The longest wait for a row lock of a bucket (SEC-3), like the code-request counters: a wait
// that long ends in 503 with nothing counted (the transaction rolls back), instead of holding
// the connections of the small krajozbior_auth pool.
export const THROTTLE_LOCK_TIMEOUT = "2s";

// A key of its own for the account HMAC, derived from the session secret, so
// the two never serve both purposes. Rotating the secret resets the counters.
export function throttleHmacKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", "krajozbior-sign-in-throttle", 32));
}

export type ThrottleKey = { scope: ThrottleScope; key: string };

// The emails never reach the table: account buckets are keyed on an HMAC.
function accountHash(email: string, hmacKey: Buffer): string {
  return createHmac("sha256", hmacKey).update(normalizeEmail(email)).digest("hex");
}

// Password sign-in uses the keys without a prefix; checking sign-in codes uses
// CODE_VERIFY_PREFIX, so guessing codes for an admin's address never uses up
// that admin's password attempts (and the other way round).
export const CODE_VERIFY_PREFIX = "code:";

export function throttleKeys(
  subject: ThrottleSubject,
  hmacKey: Buffer,
  prefix = "",
): ThrottleKey[] {
  const account = accountHash(subject.email, hmacKey);
  const keys: ThrottleKey[] = [
    { scope: "accountIp", key: `${prefix}account_ip:${account}:${subject.ip ?? "unknown"}` },
    { scope: "account", key: `${prefix}account:${account}` },
  ];

  if (subject.ip !== null) {
    keys.push({ scope: "ip", key: `${prefix}ip:${subject.ip}` });
  }

  // A fixed order for row locks, so concurrent reservations cannot deadlock.
  return keys.sort((a, b) => a.key.localeCompare(b.key));
}

type Row = {
  key: string;
  attempts: number;
  window_started_at: Date;
  locked_until: Date | null;
  now: Date;
};

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(`set local lock_timeout = '${THROTTLE_LOCK_TIMEOUT}'`);
    const result = await work(client);
    await client.query("commit");

    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Logged on the server for observability; never the email or the password.
function logThrottled(keys: ThrottleKey[], decision: ThrottleDecision) {
  if (decision.allowed) {
    return;
  }

  console.warn(
    JSON.stringify({
      event: "auth.sign_in_throttled",
      buckets: keys.map(({ scope, key }) => (scope === "ip" ? key : key.slice(0, 24))),
      retryAfterSeconds: decision.retryAfterSeconds,
    }),
  );
}

export class PostgresSignInThrottle implements SignInThrottle {
  constructor(
    private readonly pool: () => Promise<Pool>,
    private readonly hmacKey: Buffer,
    // "" for password sign-in, CODE_VERIFY_PREFIX for checking sign-in codes.
    private readonly prefix = "",
  ) {}

  async reserve(subject: ThrottleSubject): Promise<ThrottleDecision> {
    const keys = throttleKeys(subject, this.hmacKey, this.prefix);
    const names = keys.map(({ key }) => key);

    const decision = await inTransaction(await this.pool(), async (client) => {
      await client.query(
        `insert into auth.sign_in_throttle (key) select unnest($1::text[]) on conflict do nothing`,
        [names],
      );

      const { rows } = await client.query<Row>(
        `select key, attempts, window_started_at, locked_until, now() as now
           from auth.sign_in_throttle where key = any($1::text[]) order by key for update`,
        [names],
      );
      const buckets: BucketState[] = rows.map((row) => ({
        scope: keys.find(({ key }) => key === row.key)?.scope ?? "accountIp",
        attempts: row.attempts,
        windowStartedAt: row.window_started_at,
        lockedUntil: row.locked_until,
      }));
      const result = decide(buckets, rows[0]?.now ?? new Date());

      // A refusal counts nothing, so a full IP bucket never grows the
      // victim's account counter.
      if (result.allowed) {
        await client.query(
          `update auth.sign_in_throttle
              set attempts = case when window_started_at <= now() - make_interval(secs => $2)
                                  then 1 else attempts + 1 end,
                  window_started_at = case when window_started_at <= now() - make_interval(secs => $2)
                                           then now() else window_started_at end
            where key = any($1::text[])`,
          [names, SIGN_IN_WINDOW_SECONDS],
        );
      }

      await client.query(
        `delete from auth.sign_in_throttle where key in (
           select key from auth.sign_in_throttle
            where window_started_at <= now() - make_interval(secs => $1)
              and (locked_until is null or locked_until <= now())
              and key <> all($2::text[])
            limit $3 for update skip locked)`,
        [SIGN_IN_WINDOW_SECONDS, names, CLEANUP_BATCH],
      );

      return result;
    });

    logThrottled(keys, decision);

    return decision;
  }

  async clearAccount(subject: ThrottleSubject): Promise<void> {
    const keys = throttleKeys(subject, this.hmacKey, this.prefix).filter(
      ({ scope }) => scope !== "ip",
    );

    await (
      await this.pool()
    ).query(
      `delete from auth.sign_in_throttle where key = any($1::text[]) and (locked_until is null or locked_until <= now())`,
      [keys.map(({ key }) => key)],
    );
  }
}

export type BlockTarget = { email: string } | { ip: string };

// The bucket an operator blocks: a whole account, or one client address.
export function blockKey(target: BlockTarget, hmacKey: Buffer): string {
  return "email" in target ? `account:${accountHash(target.email, hmacKey)}` : `ip:${target.ip}`;
}

// Operator procedure (`npm run auth:throttle`): a block refuses every sign-in
// of the bucket until it ends, the right password included.
export async function blockBucket(pool: Pool, key: string, minutes: number): Promise<Date> {
  const { rows } = await pool.query<{ locked_until: Date }>(
    `insert into auth.sign_in_throttle (key, locked_until)
     values ($1, now() + make_interval(mins => $2))
     on conflict (key) do update set locked_until = excluded.locked_until
     returning locked_until`,
    [key, minutes],
  );

  return rows[0].locked_until;
}

// Lifts a block and forgets the counters, also the account's per-address ones.
export async function unblockBucket(pool: Pool, key: string): Promise<void> {
  const accountIp = key.startsWith("account:")
    ? `account_ip:${key.slice("account:".length)}:`
    : null;

  await pool.query(
    `delete from auth.sign_in_throttle where key = $1 or ($2::text is not null and starts_with(key, $2))`,
    [key, accountIp],
  );
}

export async function bucketStatus(
  pool: Pool,
  key: string,
): Promise<{ attempts: number; windowStartedAt: Date; lockedUntil: Date | null } | null> {
  const { rows } = await pool.query<Row>(
    `select key, attempts, window_started_at, locked_until, now() as now
       from auth.sign_in_throttle where key = $1`,
    [key],
  );

  return rows[0] === undefined
    ? null
    : {
        attempts: rows[0].attempts,
        windowStartedAt: rows[0].window_started_at,
        lockedUntil: rows[0].locked_until,
      };
}
