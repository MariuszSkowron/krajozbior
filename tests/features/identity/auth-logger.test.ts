import { afterEach, describe, expect, it, vi } from "vitest";

import { authLogger, formatAuthLog } from "@/features/identity/infrastructure/auth-logger";

// The library's log must carry the class of an error and its SQLSTATE, never message, detail
// or stack (D-E11-5); the integration test auth-log-redaction.test.ts does the same with a
// real PostgreSQL error.
const ADDRESS = "fikcyjna.osoba@example.test";

function databaseError(): Error {
  return Object.assign(new Error(`duplicate key value for ${ADDRESS}`), {
    name: "error",
    code: "23505",
    detail: `Key (email)=(${ADDRESS}) already exists.`,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatAuthLog", () => {
  it("prints the class and the SQLSTATE of an error, never its message or detail", () => {
    const line = formatAuthLog("error", "Failed to run background task:", [databaseError()]);

    expect(line).toBe("[Better Auth] error: Failed to run background task: error (SQLSTATE 23505)");
    expect(line).not.toContain(ADDRESS);
  });

  it("prints only the class when the error has no SQLSTATE or a malformed one", () => {
    const plain = Object.assign(new TypeError(`bad ${ADDRESS}`), { code: "ECONNREFUSED" });

    expect(formatAuthLog("error", "INTERNAL_SERVER_ERROR", [new RangeError(ADDRESS)])).toBe(
      "[Better Auth] error: INTERNAL_SERVER_ERROR RangeError",
    );
    expect(formatAuthLog("error", "INTERNAL_SERVER_ERROR", [plain])).toBe(
      "[Better Auth] error: INTERNAL_SERVER_ERROR TypeError",
    );
  });

  it("replaces an error name that is not a plain word", () => {
    const odd = Object.assign(new Error("x"), { name: `Odd ${ADDRESS}` });

    expect(formatAuthLog("error", "Failed", [odd])).toBe("[Better Auth] error: Failed Error");
  });

  it("replaces a message that carries data (a colon, bracket or quote in the middle)", () => {
    for (const message of [
      `Request failed: ${ADDRESS}`,
      `Failed (${ADDRESS})`,
      `Failed "${ADDRESS}"`,
      "x".repeat(500),
    ]) {
      expect(formatAuthLog("warn", message, [])).toBe("[Better Auth] warn: Better Auth error");
    }
  });

  it("drops arguments that are not errors", () => {
    const line = formatAuthLog("warn", "Plain message", [
      ADDRESS,
      { email: ADDRESS },
      undefined,
      42,
    ]);

    expect(line).toBe("[Better Auth] warn: Plain message");
  });
});

describe("authLogger", () => {
  it("writes errors, warnings and the rest to the matching console method", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    authLogger.log?.("error", "Failed", databaseError());
    authLogger.log?.("warn", "Careful");
    authLogger.log?.("info", "Fine", ADDRESS);

    expect(error).toHaveBeenCalledExactlyOnceWith(
      "[Better Auth] error: Failed error (SQLSTATE 23505)",
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith("[Better Auth] warn: Careful");
    expect(log).toHaveBeenCalledExactlyOnceWith("[Better Auth] info: Fine");
  });
});
