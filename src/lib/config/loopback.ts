// Hosts that never leave the machine: localhost, 127.0.0.0/8 and ::1. Used to
// allow plain http for a local production build (E2E) and to keep the demo
// seed off shared databases (issue #39).
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");

  return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

export class NonLocalDatabaseError extends Error {
  constructor() {
    // Never the URL: it carries the role's password.
    super("Demo accounts are seeded only into a database on localhost");
    this.name = "NonLocalDatabaseError";
  }
}

// True only for a connection string that certainly stays on this machine. The
// pg driver (pg-connection-string) takes the host from the `host` query
// parameter (and `hostaddr`) over the one in the authority, so the authority
// alone proves nothing: any `host*` parameter, a Unix socket path included, an
// unparsable value, a list of hosts or a non-loopback host gives false.
export function isLocalDatabaseUrl(value: string | undefined): boolean {
  let url: URL;

  // The URL parser strips some white and control characters, the driver does
  // not: what it would read differs from what is checked here.
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(value ?? "")) {
    return false;
  }

  try {
    url = new URL(value ?? "");
  } catch {
    return false;
  }

  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase().startsWith("host")) {
      return false;
    }
  }

  return isLoopbackHost(url.hostname);
}

// Refuses a connection string that is not local (see isLocalDatabaseUrl), so a
// production DATABASE_AUTH_URL never gets accounts with the shared demo password.
export function assertLocalDatabaseUrl(value: string | undefined): void {
  if (!isLocalDatabaseUrl(value)) {
    throw new NonLocalDatabaseError();
  }
}
