// Guard for E2E steps that write through DATABASE_ADMIN_URL (cleanup of demo-account rows). It accepts
// only the disposable E2E database: loopback host and database `krajozbior_e2e`, the name created by
// CI and by scripts/test-env/. The developer database is `krajozbior` (usually on port 5432), so it is
// refused whatever its port; the port is not checked because the CI service container uses 5432.
const E2E_DATABASE = "krajozbior_e2e";

export function parseE2eAdminDatabaseUrl(value: string | undefined): string {
  let url: URL;

  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error("DATABASE_ADMIN_URL must target the disposable E2E database");
  }

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const protocolOk = url.protocol === "postgres:" || url.protocol === "postgresql:";

  if (!protocolOk || !local || url.pathname !== `/${E2E_DATABASE}`) {
    // Never the URL: it carries a password.
    throw new Error(
      `DATABASE_ADMIN_URL must target localhost database ${E2E_DATABASE} (refusing to clean up)`,
    );
  }

  return value as string;
}
