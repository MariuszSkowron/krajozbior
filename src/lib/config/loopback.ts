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

// Refuses a connection string whose host is not loopback, a Unix socket or an
// unparsable value included, so a production DATABASE_AUTH_URL never gets
// accounts with the shared demo password.
export function assertLocalDatabaseUrl(value: string | undefined): void {
  let hostname = "";

  try {
    hostname = new URL(value ?? "").hostname;
  } catch {
    throw new NonLocalDatabaseError();
  }

  if (!isLoopbackHost(hostname)) {
    throw new NonLocalDatabaseError();
  }
}
