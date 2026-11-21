import { ConstraintViolationException, DriverException } from "@mikro-orm/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatabaseQueryError, withoutQueryText } from "@/lib/db/database-error";

// What the driver reports for a failed query: the message holds the text of the query with the
// values inlined, and the error's own fields repeat parts of it.
const USER_VALUE = "wartosc-uzytkownika-12345";

const driverError = (code: string | undefined, Type = DriverException) => {
  const previous = Object.assign(
    new Error(`select * from "visits" where "note" = '${USER_VALUE}' - relation does not exist`),
    { code, detail: `Key (note)=(${USER_VALUE}) is not present`, sqlMessage: USER_VALUE },
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
    expect(everythingPrintable(result as Error)).not.toContain(USER_VALUE);
    expect(everythingPrintable(result as Error)).not.toContain("visits");
    expect(everythingPrintable(result as Error)).not.toContain("select");
    expect((result as Error).message).toBe("Database query failed (SQLSTATE 42P01)");
    expect((result as DatabaseQueryError).code).toBe("42P01");
    expect((result as Error).cause).toBeUndefined();
  });

  it("keeps the name of the violated constraint and the frames of the call site", () => {
    const original = driverError("23505", ConstraintViolationException);

    Object.assign(original, { constraint: "collections_slug_key" });
    const result = withoutQueryText(original) as DatabaseQueryError;

    expect(result.constraint).toBe("collections_slug_key");
    expect(result.stack).toMatch(/\n\s+at /);
    expect(everythingPrintable(result)).not.toContain(USER_VALUE);
  });

  it("drops a constraint that is not a plain schema name", () => {
    const original = driverError("23505");

    Object.assign(original, { constraint: `x ${USER_VALUE}` });

    expect((withoutQueryText(original) as DatabaseQueryError).constraint).toBeUndefined();
  });

  it("keeps the class of the failure as the name", () => {
    expect(
      (withoutQueryText(driverError("23503", ConstraintViolationException)) as Error).name,
    ).toBe("ConstraintViolationException");
  });

  it("drops a code that is not a SQLSTATE (a network error code, anything odd)", () => {
    for (const code of [undefined, "ECONNREFUSED", `x${USER_VALUE}`]) {
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
