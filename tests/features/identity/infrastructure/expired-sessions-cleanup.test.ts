import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authPool = vi.hoisted(() => ({ getAuthPool: vi.fn() }));

vi.mock("@/features/identity/infrastructure/better-auth", () => ({
  BetterAuthIdentityProvider: class {},
  getAuthPool: authPool.getAuthPool,
}));
vi.mock("@/lib/config/env", () => ({ getAuthEnv: () => ({}) }));

const { deleteExpiredSessions, EXPIRED_SESSIONS_CLEANUP_BATCH } =
  await import("@/features/identity/infrastructure/postgres-expired-sessions-cleanup");
const { cleanupExpiredSessions } = await import("@/features/identity/infrastructure");

function fakePool(failOn?: string) {
  const query = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rowCount: number }>>(
    async (sql) => {
      if (failOn !== undefined && sql.startsWith(failOn)) {
        throw new Error("boom");
      }

      return { rowCount: 7 };
    },
  );
  const release = vi.fn();

  return { pool: { connect: async () => ({ query, release }) } as unknown as Pool, query, release };
}

describe("deleteExpiredSessions", () => {
  it("deletes expired rows in one bounded, time-limited transaction", async () => {
    const { pool, query, release } = fakePool();

    expect(await deleteExpiredSessions(pool)).toBe(7);

    const calls = query.mock.calls.map(([sql]) => sql as string);

    expect(calls[0]).toBe("begin");
    expect(calls[1]).toContain("statement_timeout");
    expect(calls[2]).toContain("expires_at < now()");
    expect(calls[2]).toContain("limit $1");
    expect(query.mock.calls[2][1]).toEqual([EXPIRED_SESSIONS_CLEANUP_BATCH]);
    expect(calls[3]).toBe("commit");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back, releases the connection and rethrows on a failure", async () => {
    const { pool, query, release } = fakePool("delete");

    await expect(deleteExpiredSessions(pool)).rejects.toThrow("boom");
    expect(query.mock.calls.map(([sql]) => sql)).toContain("rollback");
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("cleanupExpiredSessions", () => {
  beforeEach(() => {
    authPool.getAuthPool.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("never throws and logs the error class only", async () => {
    authPool.getAuthPool.mockRejectedValue(new Error("secret detail user@example.test"));

    await expect(cleanupExpiredSessions()).resolves.toBeUndefined();

    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);

    expect(logged).toContain("Error");
    expect(logged).not.toContain("user@example.test");
  });

  it("deletes through the verified auth pool", async () => {
    const { pool, query } = fakePool();

    authPool.getAuthPool.mockResolvedValue(pool);
    await cleanupExpiredSessions();

    expect(query).toHaveBeenCalledWith("commit");
  });
});
