import "server-only";

import { createHmac, hkdfSync } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { emailLimitKey } from "../domain/email-limit-key";
import {
  DEFAULT_OTP_NEW_ACCOUNT_DAILY_LIMIT,
  decideOtpSend,
  globalLimitAlarm,
  NEW_ACCOUNTS_PER_IP_DAILY,
  OTP_SEND_WINDOW_SECONDS,
  otpPools,
  type OtpDailyBucket,
  type OtpSendDecision,
  type OtpSendLimiter,
  type OtpSendScope,
  type OtpSendSubject,
  type OtpWindowBucket,
} from "../domain/otp-send-limits";

// Rows of ended windows (auth.sign_in_throttle) and of old days
// (auth.otp_send_counters) one request removes, so both tables stay bounded
// without a separate job.
const CLEANUP_BATCH = 100;
// Daily rows older than this many UTC days are removed.
const DAILY_RETENTION_DAYS = 2;
// The longest wait for a row lock of a counter (above all the shared global
// row). A flood of requests then ends in 503 unavailable, with nothing used up
// (the transaction rolls back), instead of holding the connections of the
// krajozbior_auth pool that sessions and password sign-in also need.
const COUNTER_LOCK_TIMEOUT = "2s";

// A key of its own for the HMAC of addresses and IPs, derived from the session
// secret; rotating the secret resets the counters.
export function otpSendHmacKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", "krajozbior-otp-send-limits", 32));
}

// Neither the address nor the IP reaches the tables in clear text: both are
// stored as an HMAC. The IP is hashed with an `ip:` prefix, so its hash can
// never equal the hash of an address. The IP comes already reduced to the unit
// of the limits (clientIp: an IPv6 address as its /64).
export function emailHash(email: string, hmacKey: Buffer): string {
  return createHmac("sha256", hmacKey).update(emailLimitKey(email)).digest("hex");
}

export function ipHash(ip: string, hmacKey: Buffer): string {
  return createHmac("sha256", hmacKey).update(`ip:${ip}`).digest("hex");
}

export type OtpBucketKeys = {
  window: { scope: OtpSendScope; key: string }[];
  daily: { scope: OtpDailyBucket["scope"]; key: string }[];
};

export function otpSendKeys(subject: OtpSendSubject, hmacKey: Buffer): OtpBucketKeys {
  const email = emailHash(subject.email, hmacKey);
  const ip = subject.ip === null ? null : ipHash(subject.ip, hmacKey);
  const emailIp = `${email}:${ip ?? "unknown"}`;
  const window: OtpBucketKeys["window"] = [
    { scope: "emailIp", key: `otp_send:email_ip:${emailIp}` },
    { scope: "email", key: `otp_send:email:${email}` },
  ];
  // The pool rows and the per-mailbox sent counter are in the set for every
  // request, so both kinds of address take the same locks and queries.
  const daily: OtpBucketKeys["daily"] = [
    { scope: "emailIp", key: `email_ip:${emailIp}` },
    { scope: "email", key: `email:${email}` },
    { scope: "global", key: "global" },
    { scope: "accounts", key: "accounts" },
    { scope: "newAccounts", key: "new_accounts" },
    { scope: "sentEmail", key: `sent_email:${email}` },
  ];

  if (ip !== null) {
    window.push({ scope: "ip", key: `otp_send:ip:${ip}` });
    daily.push({ scope: "ip", key: `ip:${ip}` });
  }

  // A fixed order for row locks, so concurrent requests cannot deadlock.
  window.sort((a, b) => a.key.localeCompare(b.key));
  daily.sort((a, b) => a.key.localeCompare(b.key));

  return { window, daily };
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("begin");
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

const POOL_SCOPES: readonly OtpDailyBucket["scope"][] = [
  "global",
  "accounts",
  "newAccounts",
  "sentEmail",
];
const isPoolScope = (scope: OtpDailyBucket["scope"]) => POOL_SCOPES.includes(scope);

// Alarm events per pool, logged once at 80% and once at 100% (no address, IP or hash).
const POOL_ALARMS: Partial<Record<OtpDailyBucket["scope"], { prefix: string; field: string }>> = {
  global: { prefix: "auth.otp_global_limit_", field: "globalLimit" },
  accounts: { prefix: "auth.otp_accounts_limit_", field: "limit" },
  newAccounts: { prefix: "auth.otp_new_account_limit_", field: "limit" },
};

type WindowRow = {
  key: string;
  attempts: number;
  window_started_at: Date;
  locked_until: Date | null;
  now: Date;
};

export class PostgresOtpSendLimiter implements OtpSendLimiter {
  constructor(
    private readonly pool: () => Promise<Pool>,
    private readonly hmacKey: Buffer,
    private readonly globalLimit: () => number,
    private readonly newAccountLimit: () => number = () => DEFAULT_OTP_NEW_ACCOUNT_DAILY_LIMIT,
    // Lowered only by tests, to reach the per-IP threshold of new addresses.
    private readonly newAccountsPerIp: number = NEW_ACCOUNTS_PER_IP_DAILY,
  ) {}

  async reserve(subject: OtpSendSubject): Promise<OtpSendDecision> {
    const keys = otpSendKeys(subject, this.hmacKey);
    const windowNames = keys.window.map(({ key }) => key);
    const dailyNames = keys.daily.map(({ key }) => key);
    const poolNames = keys.daily.filter(({ scope }) => isPoolScope(scope)).map(({ key }) => key);
    const addressNames = keys.daily
      .filter(({ scope }) => !isPoolScope(scope))
      .map(({ key }) => key);
    const globalLimit = this.globalLimit();
    const newAccountLimit = this.newAccountLimit();
    const pools = otpPools(globalLimit, newAccountLimit);

    return inTransaction(await this.pool(), async (client) => {
      await client.query(`set local lock_timeout = '${COUNTER_LOCK_TIMEOUT}'`);
      // One lookup for every request that passed the format check, whatever its
      // outcome, so the work does not depend on whether the account exists. The
      // address arrives lowercased, as better-auth stores and finds it.
      const {
        rows: [account],
      } = await client.query<{ has_account: boolean }>(
        `select exists (select 1 from auth.users where email = $1) as has_account`,
        [subject.email.toLowerCase()],
      );
      const hasAccount = account?.has_account === true;
      // Locks first the 15-minute rows, then the daily rows, always in the
      // same order. The address and IP rows that do not exist yet count as zero
      // and are created only by an accepted request. The pool rows and the
      // mailbox counter are created at zero first, so two requests at
      // `limit - 1` lock the same row instead of both passing.
      await client.query(
        `insert into auth.sign_in_throttle (key) select unnest($1::text[]) on conflict do nothing`,
        [windowNames],
      );
      await client.query(
        `insert into auth.otp_send_counters (bucket, day, count)
         select unnest($1::text[]), (now() at time zone 'utc')::date, 0
         on conflict (bucket, day) do nothing`,
        [poolNames],
      );
      const { rows: windowRows } = await client.query<WindowRow>(
        `select key, attempts, window_started_at, locked_until, now() as now
           from auth.sign_in_throttle where key = any($1::text[]) order by key for update`,
        [windowNames],
      );
      const { rows: dailyRows } = await client.query<{ bucket: string; count: number }>(
        `select bucket, count from auth.otp_send_counters
          where bucket = any($1::text[]) and day = (now() at time zone 'utc')::date
          order by bucket for update`,
        [dailyNames],
      );

      const window: OtpWindowBucket[] = windowRows.map((row) => ({
        scope: keys.window.find(({ key }) => key === row.key)?.scope ?? "emailIp",
        attempts: row.attempts,
        windowStartedAt: row.window_started_at,
        lockedUntil: row.locked_until,
      }));
      const daily: OtpDailyBucket[] = dailyRows.flatMap((row) => {
        const scope = keys.daily.find(({ key }) => key === row.bucket)?.scope;

        return scope === undefined ? [] : [{ scope, count: row.count }];
      });
      const decision = decideOtpSend({
        window,
        daily,
        globalLimit,
        newAccountLimit,
        hasAccount,
        newAccountsPerIp: this.newAccountsPerIp,
        now: windowRows[0]?.now ?? new Date(),
      });

      if (decision.allowed) {
        await client.query(
          `update auth.sign_in_throttle
              set attempts = case when window_started_at <= now() - make_interval(secs => $2)
                                  then 1 else attempts + 1 end,
                  window_started_at = case when window_started_at <= now() - make_interval(secs => $2)
                                           then now() else window_started_at end
            where key = any($1::text[])`,
          [windowNames, OTP_SEND_WINDOW_SECONDS],
        );
        // (a) The address and IP counters grow for every accepted request, so
        // the 429 limits do not depend on the account.
        await client.query(
          `insert into auth.otp_send_counters (bucket, day, count)
           select unnest($1::text[]), (now() at time zone 'utc')::date, 1
           on conflict (bucket, day) do update set count = auth.otp_send_counters.count + 1`,
          [addressNames],
        );
        // (b) The pools and the mailbox counter grow only when the code goes
        // out. The query runs for a skipped request too, with zero increments.
        const increment = decision.deliver ? 1 : 0;
        const increments = keys.daily
          .filter(({ scope }) => isPoolScope(scope))
          .map(({ scope, key }) => ({
            scope,
            key,
            by:
              scope === "global" || scope === "sentEmail"
                ? increment
                : !pools.shared && scope === (hasAccount ? "accounts" : "newAccounts")
                  ? increment
                  : 0,
          }));
        const { rows } = await client.query<{ bucket: string; count: number }>(
          `insert into auth.otp_send_counters (bucket, day, count)
           select n, (now() at time zone 'utc')::date, inc
             from unnest($1::text[], $2::int[]) as t(n, inc)
           on conflict (bucket, day) do update
             set count = auth.otp_send_counters.count + excluded.count
           returning bucket, count`,
          [increments.map(({ key }) => key), increments.map(({ by }) => by)],
        );

        for (const { scope, key, by } of increments) {
          const alarmOf = POOL_ALARMS[scope];
          const count = rows.find((row) => row.bucket === key)?.count;

          if (alarmOf === undefined || by === 0 || count === undefined) {
            continue;
          }

          const limit =
            scope === "global"
              ? globalLimit
              : scope === "accounts"
                ? pools.accounts
                : pools.newAccounts;
          const alarm = globalLimitAlarm(count, limit);

          if (alarm !== null) {
            console.warn(
              JSON.stringify({ event: `${alarmOf.prefix}${alarm}`, [alarmOf.field]: limit }),
            );
          }
        }

        if (!decision.deliver) {
          // Never the address, the IP or their hashes.
          console.warn(JSON.stringify({ event: "auth.otp_send_skipped", pool: decision.skipped }));
        }
      }

      await client.query(
        `delete from auth.otp_send_counters where (bucket, day) in (
           select bucket, day from auth.otp_send_counters
            where day < (now() at time zone 'utc')::date - $1::int
              and bucket <> all($2::text[])
            limit $3 for update skip locked)`,
        [DAILY_RETENTION_DAYS, dailyNames, CLEANUP_BATCH],
      );
      await client.query(
        `delete from auth.sign_in_throttle where key in (
           select key from auth.sign_in_throttle
            where starts_with(key, 'otp_send:')
              and window_started_at <= now() - make_interval(secs => $1)
              and (locked_until is null or locked_until <= now())
              and key <> all($2::text[])
            limit $3 for update skip locked)`,
        [OTP_SEND_WINDOW_SECONDS, windowNames, CLEANUP_BATCH],
      );

      if (!decision.allowed) {
        // Never the address, the IP or their hashes.
        console.warn(
          JSON.stringify({
            event: "auth.otp_send_throttled",
            reason: decision.reason,
            retryAfterSeconds: decision.retryAfterSeconds,
          }),
        );
      }

      return decision;
    });
  }
}

export type OtpUnblockTarget = { email: string } | { ip: string };

// Operator procedure (`npm run auth:throttle -- unblock-otp`): forgets the
// sign-in code request counters (15-minute and daily) of one address, with its
// per-IP buckets, or of one client IP. Returns the number of rows removed.
export async function unblockOtpSend(
  pool: Pool,
  target: OtpUnblockTarget,
  hmacKey: Buffer,
): Promise<number> {
  const hash = "email" in target ? emailHash(target.email, hmacKey) : ipHash(target.ip, hmacKey);
  const [throttle, counters] =
    "email" in target
      ? [
          await pool.query(
            `delete from auth.sign_in_throttle where key = $1 or starts_with(key, $2)`,
            [`otp_send:email:${hash}`, `otp_send:email_ip:${hash}:`],
          ),
          // Also the per-mailbox counter of codes sent.
          await pool.query(
            `delete from auth.otp_send_counters
              where bucket = any($1::text[]) or starts_with(bucket, $2)`,
            [[`email:${hash}`, `sent_email:${hash}`], `email_ip:${hash}:`],
          ),
        ]
      : [
          await pool.query(
            `delete from auth.sign_in_throttle
              where key = $1 or (starts_with(key, 'otp_send:email_ip:') and right(key, $3) = $2)`,
            [`otp_send:ip:${hash}`, `:${hash}`, hash.length + 1],
          ),
          await pool.query(
            `delete from auth.otp_send_counters
              where bucket = $1 or (starts_with(bucket, 'email_ip:') and right(bucket, $3) = $2)`,
            [`ip:${hash}`, `:${hash}`, hash.length + 1],
          ),
        ];

  return (throttle.rowCount ?? 0) + (counters.rowCount ?? 0);
}
