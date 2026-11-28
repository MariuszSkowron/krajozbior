import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { otpSendLimits } from "@/features/identity/domain/otp-send-limits";
import {
  otpSendHmacKey,
  PostgresOtpSendLimiter,
  unblockOtpSend,
} from "@/features/identity/infrastructure/postgres-otp-send-limiter";
import {
  PostgresSignInThrottle,
  throttleHmacKey,
} from "@/features/identity/infrastructure/postgres-sign-in-throttle";
import {
  closePool,
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// The limits of sign-in code requests on their own scratch database, as
// krajozbior_auth: per-address and per-IP daily caps, a global daily cap, folding
// of address aliases, and separation from the password sign-in limits.
const SECRET = "integration-only-secret-0123456789abcdef";
const hmacKey = otpSendHmacKey(SECRET);

let db: ScratchDatabase;
let pool: Pool;
let globalLimit = 1000;
let newAccountLimit = 100;
let perIpThreshold = 30;

const limiter = () =>
  new PostgresOtpSendLimiter(
    async () => pool,
    hmacKey,
    () => globalLimit,
    () => newAccountLimit,
    perIpThreshold,
  );

// An existing account (the limiter reads auth.users).
const createAccount = (email: string) =>
  admin$(`insert into auth.users (name, email) values ('x', $1)`, [email]);

const counter = async (bucket: string) =>
  (
    await admin$(
      `select count from auth.otp_send_counters where bucket = $1 and day = (now() at time zone 'utc')::date`,
      [bucket],
    )
  ).rows[0]?.count as number | undefined;

const delivered = (decision: Awaited<ReturnType<ReturnType<typeof limiter>["reserve"]>>) =>
  decision.allowed && decision.deliver;

const admin$ = (sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, (client) => client.query(sql, params));

// Requests from distinct IPs, so only the bucket under test fills up.
async function reserveMany(email: (i: number) => string, count: number, ip = (i: number) => i) {
  const decisions = [];
  for (let i = 0; i < count; i += 1) {
    decisions.push(
      await limiter().reserve({ email: email(i), ip: `198.51.${ip(i) >> 8}.${ip(i) & 255}` }),
    );
  }
  return decisions;
}

describe("PostgresOtpSendLimiter", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_otp_send");
    await db.migrate();
    pool = new Pool({ connectionString: db.urls.krajozbior_auth, max: 5 });
  }, 60_000);

  beforeEach(async () => {
    globalLimit = 1000;
    newAccountLimit = 100;
    perIpThreshold = 30;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await admin$("truncate auth.sign_in_throttle, auth.otp_send_counters");
    await admin$("delete from auth.users");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (pool) await closePool(pool);
    await db?.drop();
  });

  it("stores neither the address nor the IP in clear text", async () => {
    await limiter().reserve({ email: "jan@example.com", ip: "203.0.113.7" });

    const { rows } = await admin$(
      `select key as name from auth.sign_in_throttle union all select bucket from auth.otp_send_counters`,
    );
    const names = rows.map(({ name }) => name as string).join(" ");

    expect(names).not.toContain("jan");
    expect(names).not.toContain("203.0.113.7");
    expect(names).toContain("global");
  });

  it("caps one address per UTC day, counting all its aliases as one address", async () => {
    const aliases = (i: number) =>
      i % 2 === 0 ? `jan+${i}@gmail.com` : `j.a.n+${i}@googlemail.com`;
    // Spread over the day: clear the 15-minute windows between requests.
    const decisions = [];
    for (let i = 0; i <= otpSendLimits.daily.email; i += 1) {
      await admin$("truncate auth.sign_in_throttle");
      decisions.push(await limiter().reserve({ email: aliases(i), ip: `198.51.100.${i}` }));
    }

    expect(decisions.slice(0, otpSendLimits.daily.email).every((d) => d.allowed)).toBe(true);
    expect(decisions.at(-1)).toMatchObject({ allowed: false, reason: "rate" });
    // Another mailbox is not affected.
    expect(await limiter().reserve({ email: "ola@gmail.com", ip: "198.51.100.200" })).toMatchObject(
      { allowed: true },
    );
  });

  it("caps one IP per UTC day across many addresses", async () => {
    const decisions = [];
    for (let i = 0; i <= otpSendLimits.daily.ip; i += 1) {
      await admin$("truncate auth.sign_in_throttle");
      decisions.push(
        await limiter().reserve({ email: `osoba${i}@example.com`, ip: "203.0.113.9" }),
      );
    }

    expect(decisions.slice(0, otpSendLimits.daily.ip).every((d) => d.allowed)).toBe(true);
    expect(decisions.at(-1)).toMatchObject({ allowed: false, reason: "rate" });
  });

  // (a) The pool of new addresses: the fifth gets the same answer, but no code.
  it("skips the code of a new address once the pool of new addresses is full, and counts no pool", async () => {
    globalLimit = 10;
    newAccountLimit = 4;

    const decisions = await reserveMany((i) => `osoba${i}@example.com`, 5);

    expect(decisions.slice(0, 4).every(delivered)).toBe(true);
    expect(decisions[4]).toEqual({ allowed: true, deliver: false, skipped: "new" });
    expect(await counter("new_accounts")).toBe(4);
    expect(await counter("global")).toBe(4);
    expect(await counter("accounts")).toBe(0);
  });

  // (b) The pools are disjoint.
  it("still sends to an account when the pool of new addresses is full", async () => {
    globalLimit = 10;
    newAccountLimit = 4;
    await createAccount("stala@example.com");
    await reserveMany((i) => `osoba${i}@example.com`, 5);

    const decision = await limiter().reserve({ email: "stala@example.com", ip: "198.51.100.77" });

    expect(decision).toEqual({ allowed: true, deliver: true, skipped: null });
    expect(await counter("accounts")).toBe(1);
  });

  it("keeps the pool of new addresses when the pool of accounts is full", async () => {
    globalLimit = 6;
    newAccountLimit = 4; // accounts: 2
    for (const name of ["a", "b", "c"]) await createAccount(`${name}@example.com`);

    const accounts = await reserveMany((i) => `${["a", "b", "c"][i]}@example.com`, 3);
    const fresh = await limiter().reserve({ email: "nowa@example.com", ip: "198.51.100.90" });

    expect(accounts.map(delivered)).toEqual([true, true, false]);
    expect(accounts[2]).toEqual({ allowed: true, deliver: false, skipped: "accounts" });
    expect(fresh).toEqual({ allowed: true, deliver: true, skipped: null });
  });

  // (c) One IP cannot use up the pool of new addresses.
  it("skips new addresses from an IP over the threshold, but not an account or another IP", async () => {
    perIpThreshold = 3;
    await createAccount("stala@example.com");
    const ip = "203.0.113.20";
    const new$ = (i: number, from = ip) =>
      limiter().reserve({ email: `osoba${i}@example.com`, ip: from });
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      await admin$("truncate auth.sign_in_throttle");
      results.push(await new$(i));
    }

    expect(results.map(delivered)).toEqual([true, true, true, false]);
    expect(results[3]).toEqual({ allowed: true, deliver: false, skipped: "new_ip" });
    await admin$("truncate auth.sign_in_throttle");
    expect(await limiter().reserve({ email: "stala@example.com", ip })).toMatchObject({
      deliver: true,
    });
    expect(await new$(9, "203.0.113.21")).toMatchObject({ deliver: true });
  });

  // (c2) Nothing the IP threshold shows depends on whether a probed address has an account.
  it("leaves the same state and the same next answer whether a probed address has an account", async () => {
    perIpThreshold = 4;
    const ip = "203.0.113.30";
    const outcome = async (probed: string, hasAccount: boolean) => {
      await admin$("truncate auth.sign_in_throttle, auth.otp_send_counters");
      await admin$("delete from auth.users");
      if (hasAccount) await createAccount(probed);
      for (let i = 0; i < 3; i += 1) {
        await admin$("truncate auth.sign_in_throttle");
        await limiter().reserve({ email: `wypelnij${i}@example.com`, ip });
      }
      await admin$("truncate auth.sign_in_throttle");
      await limiter().reserve({ email: probed, ip });
      const ipCounter = (
        await admin$(`select bucket, count from auth.otp_send_counters where bucket like 'ip:%'`)
      ).rows;
      await admin$("truncate auth.sign_in_throttle");
      const next = await limiter().reserve({ email: "swiezy@example.com", ip });

      return { ipCounter, next };
    };

    expect(await outcome("sonda@example.com", true)).toEqual(
      await outcome("sonda@example.com", false),
    );
  });

  // (d) Both pools full: the answer is still "sent", for both kinds of address.
  it("never refuses when both pools are full", async () => {
    globalLimit = 4;
    newAccountLimit = 2;
    for (const name of ["a", "b", "c"]) await createAccount(`${name}@example.com`);

    await reserveMany((i) => `${["a", "b", "c", "x", "y", "z"][i]}@example.com`, 6);
    const account = await limiter().reserve({ email: "a@example.com", ip: "198.51.100.150" });
    const fresh = await limiter().reserve({ email: "n@example.com", ip: "198.51.100.151" });

    expect(account).toMatchObject({ allowed: true, deliver: false });
    expect(fresh).toMatchObject({ allowed: true, deliver: false });
  });

  // (e) The 429 counters grow the same for both kinds of address, sent or skipped.
  it("counts the address and IP buckets the same for an account and a new address", async () => {
    newAccountLimit = 1;
    await createAccount("stala@example.com");
    const ip = "203.0.113.40";
    await limiter().reserve({ email: "pierwsza@example.com", ip });
    await limiter().reserve({ email: "druga@example.com", ip }); // skipped: pool of 1
    await limiter().reserve({ email: "stala@example.com", ip });

    const { rows } = await admin$(
      `select count from auth.otp_send_counters where bucket like 'ip:%'`,
    );
    expect(rows).toEqual([{ count: 3 }]);
    expect(await counter("new_accounts")).toBe(1);
  });

  // The limit of codes sent to one mailbox (Q5): five, then silent skipping; 429 only from 20.
  it("sends at most five codes a day to one mailbox and then skips them silently", async () => {
    const decisions = [];
    for (let i = 0; i < 7; i += 1) {
      await admin$("truncate auth.sign_in_throttle");
      decisions.push(await limiter().reserve({ email: "jan@example.com", ip: `198.51.100.${i}` }));
    }

    expect(decisions.slice(0, 5).every(delivered)).toBe(true);
    expect(decisions[5]).toEqual({ allowed: true, deliver: false, skipped: "sent" });
    expect(decisions[6]).toEqual({ allowed: true, deliver: false, skipped: "sent" });
    // A skipped request uses no pool.
    expect(await counter("global")).toBe(5);
    expect(await counter("new_accounts")).toBe(5);
  });

  // (h) Two parallel requests at `limit - 1` of the pool: exactly one gets the code.
  it("lets exactly one of two parallel requests take the last place of the pool", async () => {
    globalLimit = 10;
    newAccountLimit = 4;
    await reserveMany((i) => `osoba${i}@example.com`, 3);

    const pair = await Promise.all([
      limiter().reserve({ email: "rownolegla1@example.com", ip: "198.51.100.201" }),
      limiter().reserve({ email: "rownolegla2@example.com", ip: "198.51.100.202" }),
    ]);

    expect(pair.filter(delivered)).toHaveLength(1);
    expect(await counter("new_accounts")).toBe(4);
  });

  // (h2) The first requests of the day: the pool rows do not exist yet, so the
  // limiter must create them before taking the lock (else both would pass).
  it("lets exactly one of two parallel first requests of the day take the only place", async () => {
    newAccountLimit = 1;
    await admin$("truncate auth.otp_send_counters");

    const pair = await Promise.all([
      limiter().reserve({ email: "pierwsza1@example.com", ip: "198.51.100.211" }),
      limiter().reserve({ email: "pierwsza2@example.com", ip: "198.51.100.212" }),
    ]);

    expect(pair.filter(delivered)).toHaveLength(1);
    expect(await counter("new_accounts")).toBe(1);
  });

  // (f) No address, IP or hash in the pool rows.
  it("keeps the pool rows free of addresses and IPs", async () => {
    await createAccount("stala@example.com");
    await limiter().reserve({ email: "stala@example.com", ip: "203.0.113.50" });
    await limiter().reserve({ email: "nowa@example.com", ip: "203.0.113.51" });

    const { rows } = await admin$(
      `select bucket from auth.otp_send_counters where bucket in ('global', 'accounts', 'new_accounts')`,
    );

    expect(rows.map(({ bucket }) => bucket).sort()).toEqual(["accounts", "global", "new_accounts"]);
  });

  // OPS-6 / SEC-1: the warning at 80% of the daily pool, once, before the pool
  // runs out; the hourly resource check (E11 5.7) reads these lines.
  it("logs one warning at 80% of the global daily limit and one at 100%, without addresses", async () => {
    globalLimit = 10;
    const warn = vi.mocked(console.warn);
    warn.mockClear();

    const alarmsAfter: string[][] = [];
    for (let i = 0; i < 10; i += 1) {
      await reserveMany(
        () => `osoba${i}@example.com`,
        1,
        () => i,
      );
      alarmsAfter.push(
        warn.mock.calls
          .map(([line]) => JSON.parse(String(line)) as { event: string })
          .map(({ event }) => event)
          .filter((event) => event.startsWith("auth.otp_global_limit_")),
      );
    }

    expect(alarmsAfter[6]).toEqual([]);
    expect(alarmsAfter[7]).toEqual(["auth.otp_global_limit_80"]);
    expect(alarmsAfter[8]).toEqual(["auth.otp_global_limit_80"]);
    expect(alarmsAfter[9]).toEqual(["auth.otp_global_limit_80", "auth.otp_global_limit_100"]);
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({ event: "auth.otp_global_limit_80", globalLimit: 10 }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/osoba|example\.com|198\.51\./);
  });

  // (g) Alarms of the separate pools and the skipped-code line carry no personal data.
  it("logs alarms of each pool at 80% and 100% and a line for a skipped code, without personal data", async () => {
    globalLimit = 100;
    newAccountLimit = 5;
    const warn = vi.mocked(console.warn);
    warn.mockClear();

    await reserveMany((i) => `osoba${i}@example.com`, 6);

    const lines = warn.mock.calls.map(([line]) => JSON.parse(String(line)) as { event: string });
    const events = lines.map(({ event }) => event);

    expect(events).toContain("auth.otp_new_account_limit_80");
    expect(events).toContain("auth.otp_new_account_limit_100");
    expect(events).not.toContain("auth.otp_accounts_limit_80");
    expect(lines).toContainEqual({ event: "auth.otp_send_skipped", pool: "new" });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/osoba|example\.com|198\.51\./);
  });

  it("logs the alarms of the pool of accounts", async () => {
    globalLimit = 10;
    newAccountLimit = 5; // accounts: 5
    for (let i = 0; i < 5; i += 1) await createAccount(`stala${i}@example.com`);
    const warn = vi.mocked(console.warn);
    warn.mockClear();

    await reserveMany((i) => `stala${i}@example.com`, 5);

    const events = warn.mock.calls.map(
      ([line]) => (JSON.parse(String(line)) as { event: string }).event,
    );
    expect(events).toContain("auth.otp_accounts_limit_80");
    expect(events).toContain("auth.otp_accounts_limit_100");
  });

  it("counts nothing in the address, IP and pool buckets for a refused request", async () => {
    for (let i = 0; i < otpSendLimits.window.email; i += 1) {
      await limiter().reserve({ email: "jan@example.com", ip: `198.51.100.${i}` });
    }
    const before = (await admin$(`select bucket, count from auth.otp_send_counters order by 1`))
      .rows;

    const refused = await limiter().reserve({ email: "jan@example.com", ip: "198.51.100.99" });

    expect(refused).toMatchObject({ allowed: false, reason: "rate" });
    expect(
      (await admin$(`select bucket, count from auth.otp_send_counters order by 1`)).rows,
    ).toEqual(before);
  });

  it("never touches the password sign-in budget of the same address", async () => {
    const email = "admin@example.com";
    const ip = "203.0.113.50";
    const passwordThrottle = new PostgresSignInThrottle(async () => pool, throttleHmacKey(SECRET));

    for (let i = 0; i < otpSendLimits.window.emailIp + 2; i += 1) {
      await limiter().reserve({ email, ip });
    }

    const { rows } = await admin$(
      `select count(*)::int as n from auth.sign_in_throttle where not starts_with(key, 'otp_send:')`,
    );
    expect(rows[0].n).toBe(0);
    expect(await passwordThrottle.reserve({ email, ip })).toEqual({ allowed: true });
  });

  it("lets the operator clear the counters of one address", async () => {
    for (let i = 0; i < otpSendLimits.window.email; i += 1) {
      await limiter().reserve({ email: "jan@example.com", ip: `198.51.100.${i}` });
    }
    expect(
      await limiter().reserve({ email: "jan+x@example.com", ip: "198.51.100.99" }),
    ).toMatchObject({ allowed: false });

    expect(await unblockOtpSend(pool, { email: "jan@example.com" }, hmacKey)).toBeGreaterThan(0);
    expect(
      await limiter().reserve({ email: "jan@example.com", ip: "198.51.100.99" }),
    ).toMatchObject({ allowed: true, deliver: true });
  });

  it("is reachable only by krajozbior_auth", async () => {
    for (const role of ["krajozbior_app", "krajozbior_ops"] as const) {
      await expect(
        withClient(db.urls[role], (client) => client.query("select * from auth.otp_send_counters")),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});
