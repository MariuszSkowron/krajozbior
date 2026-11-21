import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import { newUser } from "../support/album-fixtures";
import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// An unhandled database error in a server component goes to the default Next.js log with its
// message, stack and own fields. PostgreSQL puts the offending value in them: `invalid input
// syntax for type uuid: "<value>"` in the message, `Key (column)=(<value>) already exists` in
// `detail` (S3 of the statement-timeout review, finding "logs and alarms before opening"). The
// context wrappers are the only way domain code reaches the database, so they must hand on an
// error without those values; the class of the failure and the SQLSTATE stay.
let db: ScratchDatabase;
let app: MikroORM;

const actor = newUser("db-error-log");
const SECRET = "wartosc-uzytkownika-12345";

// Everything a log line could print for the error: message, stack, name, cause and its own fields.
const printable = (error: unknown): string => {
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.name, current.message, current.stack ?? "");
      parts.push(JSON.stringify(current, Object.getOwnPropertyNames(current)));
      current = current.cause;
    } else {
      parts.push(String(current));
      current = undefined;
    }
  }

  return parts.join("\n");
};

const caught = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }

  throw new Error("The query was expected to fail");
};

describe("an error from the database (production)", () => {
  beforeAll(async () => {
    // The wrappers hide the values only in production (`database-error.ts`).
    vi.stubEnv("NODE_ENV", "production");
    db = await createScratchDatabase("krajozbior_integration_error_log");
    await db.migrate();
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await app?.close(true);
    await db?.drop();
  });

  it("carries no value of the user out of the user context (a rejected value)", async () => {
    const error = await caught(() =>
      runInUserContext(app.em, { id: actor.id }, (tx) =>
        tx.em.execute(`select * from public.visits where id = ?::uuid`, [SECRET]),
      ),
    );

    expect(printable(error)).not.toContain(SECRET);
    // The class of the failure stays useful for the operator and for callers.
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: unknown }).code).toBe("22P02");
  });

  it("carries no value of the user out of the user context (a violated unique key)", async () => {
    const error = await caught(() =>
      runInUserContext(app.em, { id: actor.id }, async (tx) => {
        await tx.em.execute(`create temp table error_log_probe (note text unique) on commit drop`);
        await tx.em.execute(`insert into error_log_probe (note) values (?)`, [SECRET]);
        await tx.em.execute(`insert into error_log_probe (note) values (?)`, [SECRET]);
      }),
    );

    expect(printable(error)).not.toContain(SECRET);
    expect((error as { code?: unknown }).code).toBe("23505");
  });

  it("carries no value of the user out of the guest context", async () => {
    const error = await caught(() =>
      runInGuestContext(app.em, (tx) => tx.em.execute(`select ?::int`, [SECRET])),
    );

    expect(printable(error)).not.toContain(SECRET);
    expect((error as { code?: unknown }).code).toBe("22P02");
  });

  it("keeps the SQLSTATE that callers read, also for an error raised by a function", async () => {
    const error = await caught(() =>
      runInUserContext(app.em, { id: actor.id }, (tx) =>
        tx.em.execute(`select 1 / (?::int)`, [0], "get"),
      ),
    );

    expect((error as { code?: unknown }).code).toBe("22012");
  });

  it("passes on an error that the work itself raised, unchanged", async () => {
    const own = new RangeError(`own error with ${SECRET}`);
    const error = await caught(() =>
      runInUserContext(app.em, { id: actor.id }, async () => {
        throw own;
      }),
    );

    expect(error).toBe(own);
  });
});
