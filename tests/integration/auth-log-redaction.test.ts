import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// Better Auth writes the whole error object of a failed background task or session read to its
// own log. PostgreSQL puts the offending value in `detail` (`Key (email)=(...) already exists`),
// so without our own logger an address could reach the server log (D-E11-5, security review
// 2026-11-22, finding F1). The library's log goes through `createAuth`'s `logger` option; this
// test pushes a real unique-key error through the two paths the library uses and checks what
// is printed.
const SECRET_EMAIL = "fikcyjna.osoba.12345@example.test";

let db: ScratchDatabase;
let closeAuth: () => Promise<void>;
let context: {
  logger: { error: (message: string, ...args: unknown[]) => void };
  runInBackgroundOrAwait: (task: Promise<unknown>) => Promise<unknown> | void;
};
let realError: Error & { code?: string; detail?: string };

// A real PostgreSQL error: the second insert of the same address violates the unique key.
async function uniqueViolation(): Promise<Error & { code?: string; detail?: string }> {
  const client = new Client({ connectionString: db.adminUrl });
  await client.connect();

  try {
    const insert = `insert into auth.users (name, email) values ('Fikcyjna', $1)`;
    await client.query(insert, [SECRET_EMAIL]);
    await client.query(insert, [SECRET_EMAIL]);
  } catch (error) {
    return error as Error & { code?: string; detail?: string };
  } finally {
    await client.end();
  }

  throw new Error("The second insert was expected to fail");
}

function printedLines(...spies: { mock: { calls: unknown[][] } }[]): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) =>
      args
        .map((arg) =>
          arg instanceof Error
            ? [
                arg.name,
                arg.message,
                arg.stack ?? "",
                JSON.stringify(arg, Object.getOwnPropertyNames(arg)),
              ].join("\n")
            : String(arg),
        )
        .join(" "),
    )
    .join("\n");
}

describe("the log of the sign-in library", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_auth_log");
    await db.migrate();

    process.env.DATABASE_URL = db.urls.krajozbior_app;
    process.env.DATABASE_AUTH_URL = db.urls.krajozbior_auth;
    process.env.BETTER_AUTH_SECRET = "integration-only-secret-0123456789abcdef";
    delete process.env.BETTER_AUTH_URL;

    const auth = await import("@/features/identity/infrastructure/better-auth");
    closeAuth = auth.closeAuth;
    context = (await auth.getAuth().$context) as unknown as typeof context;
    realError = await uniqueViolation();
  }, 60_000);

  afterAll(async () => {
    await closeAuth?.();
    await db?.drop();
  });

  it("starts from an error that really carries the address (the premise of the test)", () => {
    expect(realError.code).toBe("23505");
    expect(realError.detail).toContain(SECRET_EMAIL);
  });

  it("prints no address when a background task of the library fails", async () => {
    const spies = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];

    try {
      // `runInBackgroundOrAwait` logs the rejection of the task and does not rethrow it.
      await context.runInBackgroundOrAwait(Promise.reject(realError));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const printed = printedLines(...spies);

      expect(printed).not.toContain(SECRET_EMAIL);
      expect(printed).not.toContain("Key (");
      expect(printed).toContain("23505");
      expect(printed).toContain(realError.name);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("prints no address when the library logs a failed session read", () => {
    const spies = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];

    try {
      context.logger.error("INTERNAL_SERVER_ERROR", realError);

      const printed = printedLines(...spies);

      expect(printed).not.toContain(SECRET_EMAIL);
      expect(printed).not.toContain("Key (");
      expect(printed).toContain("23505");
    } finally {
      vi.restoreAllMocks();
    }
  });
});
