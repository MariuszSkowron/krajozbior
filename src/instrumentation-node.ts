import { assertStartupConfig, ServerConfigError } from "./lib/config/env";

// Startup check for the Node.js runtime only. It lives in its own module, loaded
// dynamically from `register()` in `instrumentation.ts`, because it calls
// `process.exit`, which the Edge runtime does not support; the bundler would
// otherwise warn while compiling `instrumentation.ts` for Edge.
export function assertNodeStartupConfig(): void {
  try {
    assertStartupConfig(process.env);
  } catch (error) {
    if (!(error instanceof ServerConfigError)) {
      throw error;
    }

    // Names only (the message never holds a value).
    console.error(error.message);
    process.exit(1);
  }
}
