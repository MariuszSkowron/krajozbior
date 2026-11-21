import { DriverException } from "@mikro-orm/core";

// An unhandled error in a server component goes to the default Next.js log with its message,
// stack and own fields. PostgreSQL echoes values of the user in them (a search phrase, a name from
// the profile, an account id): `invalid input syntax for type uuid: "<value>"` in the message,
// `Key (column)=(<value>) already exists` and the failing row in `detail`, and more in `where`
// and `internalQuery`. That is data of the user, and the privacy policy promises it never
// reaches a log (D-E11-5). So the context wrappers in `user-context.ts`, the only way domain
// code reaches the database, replace such an error with this one: the class of the failure, the
// SQLSTATE and the name of the violated constraint (a schema name, not data of the user), plus
// the stack frames of the call site.
//
// Rule for code that catches the error after it left the context: read only `code` and
// `constraint`, never `message` or `detail` (in production they are gone, in tests they are not).
const SQLSTATE = /^[0-9A-Z]{5}$/;
const CONSTRAINT_NAME = /^[A-Za-z0-9_]{1,63}$/;

export class DatabaseQueryError extends Error {
  /** The SQLSTATE (for example 23503 or 57014), when the driver reported one. */
  readonly code?: string;
  /** The name of the violated constraint or index, when the driver reported one. */
  readonly constraint?: string;

  constructor(name: string, code?: string, constraint?: string, frames = "") {
    super(
      code === undefined ? "Database query failed" : `Database query failed (SQLSTATE ${code})`,
    );
    // The name of the driver's class (for example ConnectionException), never its message.
    this.name = /^[A-Za-z]{1,64}$/.test(name) ? name : "DriverException";
    if (code !== undefined) {
      this.code = code;
    }
    if (constraint !== undefined) {
      this.constraint = constraint;
    }
    // Only the `at ...` lines of the original stack: they name functions and files, so the
    // failing call stays findable; the first lines (the message) are left out.
    this.stack = `${this.name}: ${this.message}${frames === "" ? "" : `\n${frames}`}`;
  }
}

function stackFrames(error: Error): string {
  return String(error.stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .join("\n");
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
  const rawConstraint = (error as { constraint?: unknown }).constraint;
  const constraint =
    typeof rawConstraint === "string" && CONSTRAINT_NAME.test(rawConstraint)
      ? rawConstraint
      : undefined;

  return new DatabaseQueryError(error.name, code, constraint, stackFrames(error));
}
