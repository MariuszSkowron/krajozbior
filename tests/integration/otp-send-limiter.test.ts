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
// starter_auth: per-address and per-IP daily caps, a global daily cap, folding
// of address aliases, and separation from the password sign-in limits.
const SECRET = "integration-only-secret-0123456789abcdef";
const hmacKey = otpSendHmacKey(SECRET);

let db: ScratchDatabase;
let pool: Pool;
let globalLimit = 1000;

const limiter = () =>
  new PostgresOtpSendLimiter(
    async () => pool,
    hmacKey,
    () => globalLimit,
  );

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
    db = await createScratchDatabase("starter_integration_otp_send");
    await db.migrate();
    pool = new Pool({ connectionString: db.urls.starter_auth, max: 5 });
  }, 60_000);

  beforeEach(async () => {
    globalLimit = 1000;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await admin$("truncate auth.sign_in_throttle, auth.otp_send_counters");
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
    expect(await limiter().reserve({ email: "ola@gmail.com", ip: "198.51.100.200" })).toEqual({
      allowed: true,
    });
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

  it("stops every request at the global daily limit, with the same answer for all", async () => {
    globalLimit = 3;

    const decisions = await reserveMany((i) => `osoba${i}@example.com`, 4);

    expect(decisions.slice(0, 3).every((d) => d.allowed)).toBe(true);
    expect(decisions[3]).toMatchObject({ allowed: false, reason: "global" });
    expect(
      (await admin$(`select count from auth.otp_send_counters where bucket = 'global'`)).rows,
    ).toEqual([{ count: 3 }]);
  });

  it("counts nothing for a refused request", async () => {
    globalLimit = 1;
    await limiter().reserve({ email: "a@example.com", ip: "198.51.100.1" });
    await limiter().reserve({ email: "b@example.com", ip: "198.51.100.2" });

    const { rows } = await admin$(
      `select count(*)::int as n from auth.otp_send_counters where bucket <> 'global'`,
    );
    expect(rows[0].n).toBe(3);
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
    expect(await limiter().reserve({ email: "jan@example.com", ip: "198.51.100.99" })).toEqual({
      allowed: true,
    });
  });

  it("is reachable only by starter_auth", async () => {
    for (const role of ["starter_app", "starter_ops"] as const) {
      await expect(
        withClient(db.urls[role], (client) => client.query("select * from auth.otp_send_counters")),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});
