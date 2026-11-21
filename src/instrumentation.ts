// Called once when a Next.js server starts, before it serves requests; never
// during `next build`. A production server with a missing or wrong setting
// (above all the e-mail transport and the Brevo key) stops here with the names
// of the wrong variables, so a deployment fails its health check instead of
// starting "healthy" and failing on the first sign-in (E11 5.5).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { assertStartupConfig } = await import("./lib/config/env");

  assertStartupConfig(process.env);
}
