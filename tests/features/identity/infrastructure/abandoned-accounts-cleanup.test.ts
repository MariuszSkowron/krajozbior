import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { deleteAccountRows } =
  await import("@/features/identity/infrastructure/delete-account-rows");
const { deleteAbandonedAccounts, ABANDONED_ACCOUNT_DAYS } =
  await import("@/features/identity/infrastructure/postgres-abandoned-accounts-cleanup");

// A pool whose connection answers by statement: the account exists, and the database guard
// answers `abandoned` for the ids in `abandonedIds`.
function fakePool(candidates: string[], abandonedIds: string[]) {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));

      if (sql.includes("select email from auth.users")) {
        return { rows: [{ email: "a@example.test" }] };
      }

      if (sql.includes("auth_account_is_abandoned")) {
        return { rows: [{ abandoned: abandonedIds.includes(params[0] as string) }] };
      }

      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: async () => client,
    query: vi.fn(async (...args: unknown[]) => {
      void args;

      return { rows: candidates.map((id) => ({ id })) };
    }),
  } as unknown as Pool;

  return { pool, client, statements };
}

describe("deleteAccountRows with the abandoned-account guard", () => {
  it("rolls back and deletes nothing when the database says the account is not abandoned", async () => {
    const { pool, client, statements } = fakePool([], []);

    expect(await deleteAccountRows(pool, "id-1", { onlyAbandonedOlderThanDays: 0 })).toBe(false);
    expect(statements).not.toContain("delete from auth.users");
    expect(client.query).toHaveBeenCalledWith("rollback");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("deletes the account when the database says it is abandoned", async () => {
    const { pool, client } = fakePool([], ["id-1"]);

    expect(await deleteAccountRows(pool, "id-1", { onlyAbandonedOlderThanDays: 0 })).toBe(true);
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("does not ask the guard when no guard is requested (the own deletion of E9-5)", async () => {
    const { pool, client } = fakePool([], []);

    expect(await deleteAccountRows(pool, "id-1")).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]) => String(sql).includes("auth_account_is_abandoned")),
    ).toBe(false);
  });
});

describe("deleteAbandonedAccounts", () => {
  it("uses the 7-day limit and counts only the accounts the guard let through", async () => {
    const { pool } = fakePool(["a", "b", "c"], ["a", "c"]);

    expect(ABANDONED_ACCOUNT_DAYS).toBe(7);
    expect(await deleteAbandonedAccounts(pool)).toBe(2);

    const [sql, params] = vi.mocked(pool.query).mock.calls[0] as unknown as [string, unknown[]];

    expect(sql).toContain("u.role = 'user'");
    expect(sql).toContain("auth_account_is_abandoned");
    expect(params[0]).toBe(7);
  });

  it("removes nothing when there are no candidates", async () => {
    expect(await deleteAbandonedAccounts(fakePool([], []).pool)).toBe(0);
  });
});
