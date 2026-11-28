import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { DriverException } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatabaseQueryError } from "@/lib/db/database-error";
import {
  AdminContextError,
  InvalidActorIdError,
  InvalidSessionTokenError,
  NestedUserContextError,
  runInAdminContext,
  runInGuestContext,
  runInUserContext,
} from "@/lib/db/user-context";

const actorId = "0b6f7a3e-4c1d-4f8a-9b2e-5d6c7e8f9a0b";

function fakeEntityManager({ inTransaction = false } = {}) {
  const calls: string[] = [];
  const tx = {
    execute: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push(`${sql} ${JSON.stringify(params)}`);
    }),
  };
  const em = {
    isInTransaction: () => inTransaction,
    transactional: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      calls.push("begin");
      try {
        const result = await callback(tx);
        calls.push("commit");
        return result;
      } catch (error) {
        calls.push("rollback");
        throw error;
      }
    }),
  };

  return { em: em as unknown as EntityManager, tx, calls };
}

describe("runInUserContext", () => {
  it("sets the actor transaction-locally before any work and hands over the transaction", async () => {
    const { em, tx, calls } = fakeEntityManager();

    const result = await runInUserContext(em, { id: actorId }, async (context) => {
      calls.push("work");
      expect(context.em).toBe(tx);
      return "done";
    });

    expect(result).toBe("done");
    expect(calls).toEqual([
      "begin",
      `select set_config('app.user_id', ?, true) ["${actorId}"]`,
      "work",
      "commit",
    ]);
  });

  it.each(["", "not-a-uuid", "1 or 1=1", `${actorId}'; reset app.user_id; --`])(
    "refuses an actor id that is not a UUID without touching the database: %j",
    async (id) => {
      const { em, calls } = fakeEntityManager();
      const work = vi.fn();

      await expect(runInUserContext(em, { id }, work)).rejects.toBeInstanceOf(InvalidActorIdError);
      expect(work).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    },
  );

  it("rolls back and rethrows when the work fails", async () => {
    const { em, calls } = fakeEntityManager();
    const failure = new Error("domain rule failed");

    await expect(
      runInUserContext(em, { id: actorId }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(calls.at(-1)).toBe("rollback");
  });

  it("refuses to open inside another transaction, where the actor would replace the outer one", async () => {
    const { em, calls } = fakeEntityManager({ inTransaction: true });
    const work = vi.fn();

    await expect(runInUserContext(em, { id: actorId }, work)).rejects.toBeInstanceOf(
      NestedUserContextError,
    );
    expect(work).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe("runInAdminContext", () => {
  const token = "sekretny-token-sesji-0123456789";

  it("sets the actor and the session token transaction-locally before the work", async () => {
    const { em, tx, calls } = fakeEntityManager();

    const result = await runInAdminContext(em, { id: actorId }, token, async (context) => {
      calls.push("work");
      expect(context.em).toBe(tx);
      return "done";
    });

    expect(result).toBe("done");
    expect(calls).toEqual([
      "begin",
      `select set_config('app.user_id', ?, true) ["${actorId}"]`,
      `select set_config('app.session_token', ?, true) ["${token}"]`,
      "work",
      "commit",
    ]);
  });

  it("refuses an actor id that is not a UUID without touching the database", async () => {
    const { em, calls } = fakeEntityManager();

    await expect(runInAdminContext(em, { id: "x" }, token, vi.fn())).rejects.toBeInstanceOf(
      InvalidActorIdError,
    );
    expect(calls).toEqual([]);
  });

  it.each(["", "a".repeat(513), "ab\ncd", "ab\u0000cd"])(
    "refuses a token that cannot be a session token without touching the database: %j",
    async (bad) => {
      const { em, calls } = fakeEntityManager();
      const error = (await runInAdminContext(em, { id: actorId }, bad, vi.fn()).catch(
        (caught: unknown) => caught,
      )) as Error;

      expect(error).toBeInstanceOf(InvalidSessionTokenError);
      expect(error.message).not.toContain("cd");
      expect(calls).toEqual([]);
    },
  );

  it("refuses to open inside another transaction", async () => {
    const { em, calls } = fakeEntityManager({ inTransaction: true });

    await expect(runInAdminContext(em, { id: actorId }, token, vi.fn())).rejects.toBeInstanceOf(
      NestedUserContextError,
    );
    expect(calls).toEqual([]);
  });

  it("rolls back and rethrows an error of the work unchanged", async () => {
    const { em, calls } = fakeEntityManager();
    const failure = new Error("domain rule failed");

    await expect(
      runInAdminContext(em, { id: actorId }, token, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(calls.at(-1)).toBe("rollback");
  });

  it("never lets the token into the error when the database refuses it", async () => {
    const { em, tx } = fakeEntityManager();

    tx.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("app.session_token")) {
        throw new Error(`select set_config('app.session_token', '${token}', true) - failed`);
      }
    });
    const error = (await runInAdminContext(em, { id: actorId }, token, vi.fn()).catch(
      (caught: unknown) => caught,
    )) as Error;

    expect(error).toBeInstanceOf(AdminContextError);
    expect(error.message).not.toContain(token);
    expect(String(error.stack)).not.toContain(token);
    expect(error.cause).toBeUndefined();
  });
});

describe("runInGuestContext", () => {
  it("opens a read-only transaction and clears any user left on the connection", async () => {
    const { em, calls } = fakeEntityManager();

    const result = await runInGuestContext(em, async () => "public");

    expect(result).toBe("public");
    expect(calls).toEqual([
      "begin",
      "set transaction read only []",
      `select set_config('app.user_id', '', true) []`,
      "commit",
    ]);
  });

  it("rolls back and rethrows when the work fails", async () => {
    const { em, calls } = fakeEntityManager();
    const failure = new Error("read failed");

    await expect(
      runInGuestContext(em, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(calls.at(-1)).toBe("rollback");
  });

  it("refuses to open inside another transaction", async () => {
    const { em, calls } = fakeEntityManager({ inTransaction: true });

    await expect(runInGuestContext(em, vi.fn())).rejects.toBeInstanceOf(NestedUserContextError);
    expect(calls).toEqual([]);
  });
});

describe("a database error leaving a context (production)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const userValue = "wartosc-uzytkownika-12345";
  const failing = () =>
    new DriverException(
      Object.assign(new Error(`select 1 where note = '${userValue}' - failed`), { code: "57014" }),
    );

  it("loses the query text and keeps the SQLSTATE, in the user and the guest context", async () => {
    for (const run of [
      (em: EntityManager) =>
        runInUserContext(em, { id: actorId }, async () => {
          throw failing();
        }),
      (em: EntityManager) =>
        runInGuestContext(em, async () => {
          throw failing();
        }),
    ]) {
      const { em } = fakeEntityManager();
      const error = await run(em).catch((caught: unknown) => caught as Error);

      expect(error).toBeInstanceOf(DatabaseQueryError);
      expect(String(error.stack)).not.toContain(userValue);
      expect((error as DatabaseQueryError).code).toBe("57014");
    }
  });

  it("passes on an error of the work itself unchanged", async () => {
    const { em } = fakeEntityManager();
    const own = new RangeError("own");

    await expect(
      runInUserContext(em, { id: actorId }, async () => {
        throw own;
      }),
    ).rejects.toBe(own);
  });
});

// The actor reaches PostgreSQL in one place only (issue #44): any other
// set_config('app.user_id', ...) would bypass the nesting guard of the wrapper.
describe("user context setting", () => {
  const sourceRoot = join(process.cwd(), "src");
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
    );

  it("is set only by src/lib/db/user-context.ts", () => {
    const setters = files(sourceRoot)
      .filter((file) => /\.(ts|tsx|sql)$/.test(file))
      .filter((file) => /set_config\(\s*'app\.user_id'/.test(readFileSync(file, "utf8")))
      .map((file) => relative(sourceRoot, file).split(sep).join("/"));

    expect(setters).toEqual(["lib/db/user-context.ts"]);
  });
});
