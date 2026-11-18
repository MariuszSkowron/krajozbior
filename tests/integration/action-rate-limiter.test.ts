import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresActionRateLimiter } from "@/features/identity/infrastructure/postgres-action-rate-limiter";
import {
  closePool,
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// The request limit of authenticated actions as krajozbior_auth (issue #67).
let db: ScratchDatabase;
let pool: Pool;
let limiter: PostgresActionRateLimiter;

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const limit = { limit: 3, windowSeconds: 600 };

describe("PostgresActionRateLimiter", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_action_limit");
    await db.migrate();
    pool = new Pool({ connectionString: db.urls.krajozbior_auth, max: 10 });
    limiter = new PostgresActionRateLimiter(async () => pool);
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

  it("allows up to the limit, then refuses with a retry time", async () => {
    for (let i = 0; i < limit.limit; i += 1) {
      expect(await limiter.reserve("note_save", alice, limit)).toEqual({ allowed: true });
    }

    const refused = await limiter.reserve("note_save", alice, limit);

    expect(refused.allowed).toBe(false);
    expect(refused.allowed ? 0 : refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.allowed ? 0 : refused.retryAfterSeconds).toBeLessThanOrEqual(600);
  });

  it("does not let parallel requests pass the limit", async () => {
    const decisions = await Promise.all(
      Array.from({ length: limit.limit + 7 }, () => limiter.reserve("note_save", alice, limit)),
    );

    expect(decisions.filter(({ allowed }) => allowed)).toHaveLength(limit.limit);
  });

  it("counts each user and each action on its own", async () => {
    for (let i = 0; i < limit.limit + 1; i += 1) {
      await limiter.reserve("note_save", alice, limit);
    }

    expect((await limiter.reserve("note_save", bob, limit)).allowed).toBe(true);
    expect((await limiter.reserve("other_action", alice, limit)).allowed).toBe(true);
  });

  it("starts a new window when the old one has ended", async () => {
    for (let i = 0; i < limit.limit + 1; i += 1) {
      await limiter.reserve("note_save", alice, limit);
    }

    await withClient(db.adminUrl, (client) =>
      client.query(
        `update auth.sign_in_throttle set window_started_at = now() - interval '11 minutes'
          where key = $1`,
        [`action:note_save:${alice}`],
      ),
    );

    expect((await limiter.reserve("note_save", alice, limit)).allowed).toBe(true);
  });

  it("stores only the action and the user id", async () => {
    await limiter.reserve("note_save", alice, limit);

    const keys = await withClient(db.adminUrl, async (client) =>
      (await client.query<{ key: string }>("select key from auth.sign_in_throttle")).rows.map(
        ({ key }) => key,
      ),
    );

    expect(keys).toEqual([`action:note_save:${alice}`]);
  });

  it("refuses a window longer than the sign-in cleanup keeps", async () => {
    await expect(
      limiter.reserve("note_save", alice, { limit: 1, windowSeconds: 16 * 60 }),
    ).rejects.toThrow(RangeError);
  });

  it("denies krajozbior_app any access to the counters, so it cannot reset its own limit", async () => {
    await limiter.reserve("note_save", alice, limit);

    await withClient(db.urls.krajozbior_app, async (client) => {
      await expect(
        client.query("update auth.sign_in_throttle set attempts = 0"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(client.query("delete from auth.sign_in_throttle")).rejects.toMatchObject({
        code: "42501",
      });
    });
  });
});
