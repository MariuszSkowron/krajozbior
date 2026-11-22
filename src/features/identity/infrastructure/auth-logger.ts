import type { Logger } from "better-auth";

// Better Auth hands the whole error object of a failed query to its log (`runInBackgroundOrAwait`,
// `getSession`, sign-out), and its default log prints message, stack and every own field.
// PostgreSQL echoes the values of the query there (`Key (email)=(...) already exists` in
// `detail`), and the privacy policy promises that data of a person never reaches a log (D-E11-5).
// Today those library paths only read or delete by token, so nothing leaks; this logger keeps it
// that way when the library or our hooks start writing there. Same rule as `database-error.ts`:
// of an error only the class and the SQLSTATE are printed, never message, detail or stack.
const SQLSTATE = /^[0-9A-Z]{5}$/;
const ERROR_NAME = /^[A-Za-z]{1,64}$/;
// A plain library message ("Failed to run background task:"); one that carries data
// (a pasted `e.message`) has a colon, bracket or quote in the middle.
const PLAIN_MESSAGE = /^[A-Za-z0-9 _.,!-]{1,120}:?$/;
const FALLBACK_MESSAGE = "Better Auth error";

function describeError(error: Error): string {
  const name = ERROR_NAME.test(error.name) ? error.name : "Error";
  const code = (error as { code?: unknown }).code;

  return typeof code === "string" && SQLSTATE.test(code) ? `${name} (SQLSTATE ${code})` : name;
}

/** Formats one library log line from its message and arguments; exported for the tests. */
export function formatAuthLog(level: string, message: string, args: readonly unknown[]): string {
  const safeMessage = PLAIN_MESSAGE.test(message) ? message : FALLBACK_MESSAGE;
  const errors = args.filter((arg): arg is Error => arg instanceof Error).map(describeError);

  return [`[Better Auth] ${level}: ${safeMessage}`, ...errors].join(" ");
}

export const authLogger: Logger = {
  level: "warn",
  log(level, message, ...args) {
    const line = formatAuthLog(level, message, args);

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  },
};
