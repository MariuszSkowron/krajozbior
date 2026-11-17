/** Logs a swallowed failure by context and error class only: never its message, stack or request data. */
export function logFailure(context: string, error: unknown): void {
  console.error(`${context} failed:`, error instanceof Error ? error.name : "unknown error");
}
