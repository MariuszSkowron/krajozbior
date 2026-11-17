import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signInLimits } from "@/features/identity/domain/sign-in-throttle";
import {
  PostgresSignInThrottle,
  throttleHmacKey,
  throttleKeys,
} from "@/features/identity/infrastructure/postgres-sign-in-throttle";
import {
  closePool,
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// The limiter's storage as starter_auth, on its own scratch database (issue #39).
let db: ScratchDatabase;
let pool: Pool;
let throttle: PostgresSignInThrottle;

const hmacKey = throttleHmacKey("integration-only-secret-0123456789abcdef");

const victim = { email: "user@demo.starter.local", ip: "203.0.113.7" };

// Stored attempts per bucket of the victim; a missing row counts as none.
async function attempts() {
  const keys = throttleKeys(victim, hmacKey);

  return withClient(db.adminUrl, async (client) => {
    const { rows } = await client.query<{ key: string; attempts: number }>(
      "select key, attempts from auth.sign_in_throttle where key = any($1::text[])",
      [keys.map(({ key }) => key)],
    );

    return Object.fromEntries(
      keys.map(({ scope, key }) => [scope, rows.find((row) => row.key === key)?.attempts ?? 0]),
    );
  });
}

async function rowCount() {
  return withClient(db.adminUrl, async (client) =>
    Number((await client.query("select count(*) from auth.sign_in_throttle")).rows[0].count),
  );
}

describe("PostgresSignInThrottle", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("starter_integration_throttle");
    await db.migrate();
    pool = new Pool({ connectionString: db.urls.starter_auth, max: 10 });
    throttle = new PostgresSignInThrottle(async () => pool, hmacKey);
  }, 60_000);

  beforeEach(async () => {
    await withClient(db.adminUrl, (client) => client.query("truncate auth.sign_in_throttle"));
  });

  afterAll(async () => {
    if (pool) {
      await closePool(pool);
    }
    await db?.drop();
  });

  it("never stores the email", async () => {
    await throttle.reserve(victim);

    const keys = await withClient(db.adminUrl, async (client) =>
      (await client.query<{ key: string }>("select key from auth.sign_in_throttle")).rows.map(
        ({ key }) => key,
      ),
    );

    expect(keys).toHaveLength(3);
    expect(keys.join(" ")).not.toContain("user");
  });

  it("does not let parallel attempts pass the limit", async () => {
    const decisions = await Promise.all(
      Array.from({ length: signInLimits.accountIp + 5 }, () => throttle.reserve(victim)),
    );

    expect(decisions.filter(({ allowed }) => allowed)).toHaveLength(signInLimits.accountIp);
  });

  it("counts nothing when one bucket refuses", async () => {
    for (let i = 0; i < signInLimits.ip; i += 1) {
      await throttle.reserve({ email: `other${i}@example.test`, ip: victim.ip });
    }

    expect((await throttle.reserve(victim)).allowed).toBe(false);
    expect(await attempts()).toEqual({ accountIp: 0, account: 0, ip: signInLimits.ip });
  });

  it("resets the account buckets but not the IP bucket", async () => {
    await throttle.reserve(victim);
    await throttle.clearAccount(victim);

    expect(await attempts()).toEqual({ accountIp: 0, account: 0, ip: 1 });
  });

  it("removes rows whose window has ended", async () => {
    await throttle.reserve({ email: "old@example.test", ip: "198.51.100.1" });
    await withClient(db.adminUrl, (client) =>
      client.query(
        "update auth.sign_in_throttle set window_started_at = now() - interval '1 hour'",
      ),
    );

    await throttle.reserve(victim);

    expect(await rowCount()).toBe(3);
    expect(await attempts()).toEqual({ accountIp: 1, account: 1, ip: 1 });
  });
});
