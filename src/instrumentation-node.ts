import { accessSync, constants, statSync } from "node:fs";

import {
  assertStartupConfig,
  mediaRootWarning,
  ServerConfigError,
  type MediaRootState,
} from "./lib/config/env";

// Reads the state of the photo directory: the owner of the directory must be the user of the
// process (a volume owned by root would stop every write from E4-1 on).
export function inspectMediaRoot(directory: string): MediaRootState {
  try {
    const stat = statSync(directory);

    if (!stat.isDirectory()) {
      return "not-directory";
    }

    accessSync(directory, constants.R_OK | constants.X_OK);

    return typeof process.getuid === "function" && stat.uid !== process.getuid()
      ? "wrong-owner"
      : "ok";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable";
  }
}

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

  // Only a warning, never an exit (spec E4 5.11.1): the pages work without photos.
  const warning = mediaRootWarning(process.env, inspectMediaRoot);

  if (warning !== null) {
    console.warn(warning);
  }
}
