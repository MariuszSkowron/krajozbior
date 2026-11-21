// Called once when a Next.js server starts, before it serves requests; never
// during `next build`. A production server with a missing or wrong setting
// (above all the e-mail transport and the Brevo key) ends its process here with
// code 1 and the names of the wrong variables, so a deployment fails visibly
// (a restart loop, a failing health check) instead of starting "healthy" and
// failing on the first sign-in (E11 5.5). Next itself would only log an error
// from `register()` and answer every request with 500, so the exit is explicit.
export async function register(): Promise<void> {
  // The check needs Node.js; it runs for every runtime except the Edge one.
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  const { assertStartupConfig, ServerConfigError } = await import("./lib/config/env");

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
