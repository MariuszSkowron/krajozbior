import { describe, expect, it, vi } from "vitest";

import {
  PostgresSignInThrottle,
  THROTTLE_LOCK_TIMEOUT,
} from "@/features/identity/infrastructure/postgres-sign-in-throttle";

// SEC-3: the wait for a row lock of a bucket is limited right after `begin`. The behaviour
// against a real locked row is in tests/integration/sign-in-throttle.test.ts.
describe("PostgresSignInThrottle lock timeout", () => {
  it("limits the wait for a throttle row lock right after begin", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn((sql: string) => {
        queries.push(sql.trim());

        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) };
    const throttle = new PostgresSignInThrottle(
      () => Promise.resolve(pool as never),
      Buffer.alloc(32),
    );

    await throttle.reserve({ email: "a@example.com", ip: null });

    expect(THROTTLE_LOCK_TIMEOUT).toBe("2s");
    expect(queries.slice(0, 2)).toEqual(["begin", "set local lock_timeout = '2s'"]);
    expect(queries.at(-1)).toBe("commit");
    expect(client.release).toHaveBeenCalledOnce();
  });
});
