import { DriverException } from "@mikro-orm/core";

// An unhandled error in a server component goes to the default Next.js log with its message,
// stack and own fields. PostgreSQL echoes values of the user in them (a search phrase, a name from
// the profile, an account id): `invalid input syntax for type uuid: "<value>"` in the message,
// `Key (column)=(<value>) already exists` and the failing row in `detail`, and more in `where`
// and `internalQuery`. That is data of the user, and the privacy policy promises it never
// reaches a log (D-E11-5). (MikroORM 7.2 does not add the query text itself.) So the context
// wrappers in
// `user-context.ts`, the only way domain code reaches the database, replace such an error with
// this one: the class of the failure and the SQLSTATE that callers read, nothing else.
const SQLSTATE = /^[0-9A-Z]{5}$/;

export class DatabaseQueryError extends Error {
  /** The SQLSTATE (for example 23503 or 57014), when the driver reported one. */
  readonly code?: string;

  constructor(name: string, code?: string) {
    super(
      code === undefined ? "Database query failed" : `Database query failed (SQLSTATE ${code})`,
    );
    // The name of the driver's class (for example ConnectionException), never its message.
    this.name = /^[A-Za-z]{1,64}$/.test(name) ? name : "DriverException";
    if (code !== undefined) {
      this.code = code;
    }
  }
}

/**
 * Returns the error as it may reach a log: a driver error is rebuilt without the values in its
 * message. Only in production, where the log holds data of real users; in development and in
 * tests the original message stays, because it says why a query failed (constraint, policy,
 * read-only transaction) and dozens of tests match on it.
 */
export function withoutQueryText(error: unknown): unknown {
  if (process.env.NODE_ENV !== "production" || !(error instanceof DriverException)) {
    return error;
  }

  const code = typeof error.code === "string" && SQLSTATE.test(error.code) ? error.code : undefined;

  return new DatabaseQueryError(error.name, code);
}
