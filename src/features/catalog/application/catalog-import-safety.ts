import { isLoopbackHost } from "@/lib/config/loopback";

// Local guards of the loader (the limit of curator writes is off for it, so
// it must never run against a shared or production database). Pure: the runner
// calls it before any connection.

export class UnsafeImportEnvironmentError extends Error {
  constructor(readonly code: "production" | "non_local_database") {
    // Never the connection string: it carries the password of the role.
    super(
      code === "production"
        ? "The loader does not run in production"
        : "The loader runs only against a database on localhost",
    );
    this.name = "UnsafeImportEnvironmentError";
  }
}

function hostOf(value: string | undefined): string | null {
  try {
    return new URL(value ?? "").hostname;
  } catch {
    return null;
  }
}

export function assertSafeImportEnvironment(
  env: Readonly<{
    NODE_ENV?: string | undefined;
    DATABASE_URL?: string | undefined;
    DATABASE_OPS_URL?: string | undefined;
  }>,
): void {
  if (env.NODE_ENV === "production") {
    throw new UnsafeImportEnvironmentError("production");
  }

  for (const value of [env.DATABASE_URL, env.DATABASE_OPS_URL]) {
    const host = hostOf(value);

    if (host === null || !isLoopbackHost(host)) {
      throw new UnsafeImportEnvironmentError("non_local_database");
    }
  }
}
