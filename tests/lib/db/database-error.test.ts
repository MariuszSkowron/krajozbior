import { ConstraintViolationException, DriverException } from "@mikro-orm/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatabaseQueryError, withoutQueryText } from "@/lib/db/database-error";

// What the driver reports for a failed query: the message holds the text of the query with the
// values inlined, and the error's own fields repeat parts of it.
const SECRET = "wartosc-uzytkownika-12345";

const driverError = (code: string | undefined, Type = DriverException) => {
  const previous = Object.assign(
    new Error(`select * from "visits" where "note" = '${SECRET}' - relation does not exist`),
    { code, detail: `Key (note)=(${SECRET}) is not present`, sqlMessage: SECRET },
  );

  return new Type(previous);
};

const everythingPrintable = (error: Error) =>
  [error.name, error.message, error.stack, JSON.stringify(error, Object.getOwnPropertyNames(error))]
    .map(String)
    .join("\n");

describe("withoutQueryText outside production", () => {
  it("keeps the original error, so development and tests see why a query failed", () => {
    const original = driverError("42P01");

    vi.stubEnv("NODE_ENV", "development");
    expect(withoutQueryText(original)).toBe(original);
    vi.stubEnv("NODE_ENV", "test");
    expect(withoutQueryText(original)).toBe(original);
    vi.unstubAllEnvs();
  });
});

describe("withoutQueryText", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rebuilds a driver error without the query, the values and the driver's fields", () => {
    const result = withoutQueryText(driverError("42P01"));

    expect(result).toBeInstanceOf(DatabaseQueryError);
    expect(everythingPrintable(result as Error)).not.toContain(SECRET);
    expect(everythingPrintable(result as Error)).not.toContain("visits");
    expect(everythingPrintable(result as Error)).not.toContain("select");
    expect((result as Error).message).toBe("Database query failed (SQLSTATE 42P01)");
    expect((result as DatabaseQueryError).code).toBe("42P01");
    expect((result as Error).cause).toBeUndefined();
  });

  it("keeps the class of the failure as the name", () => {
    expect(
      (withoutQueryText(driverError("23503", ConstraintViolationException)) as Error).name,
    ).toBe("ConstraintViolationException");
  });

  it("drops a code that is not a SQLSTATE (a network error code, anything odd)", () => {
    for (const code of [undefined, "ECONNREFUSED", `x${SECRET}`]) {
      const result = withoutQueryText(driverError(code)) as DatabaseQueryError;

      expect(result.code).toBeUndefined();
      expect(result.message).toBe("Database query failed");
    }
  });

  it("passes on any other error and any other value unchanged", () => {
    const own = new RangeError("own");

    expect(withoutQueryText(own)).toBe(own);
    expect(withoutQueryText("text")).toBe("text");
    expect(withoutQueryText(undefined)).toBeUndefined();
  });
});
