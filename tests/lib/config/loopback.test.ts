import { describe, expect, it } from "vitest";

import {
  assertLocalDatabaseUrl,
  isLoopbackHost,
  NonLocalDatabaseError,
} from "@/lib/config/loopback";

describe("isLoopbackHost", () => {
  it.each(["localhost", "LOCALHOST", "127.0.0.1", "127.1.2.3", "::1", "[::1]"])(
    "accepts %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each([
    "",
    "db.internal",
    "10.0.0.5",
    "192.168.1.10",
    "128.0.0.1",
    "localhost.evil.example",
    "::2",
  ])("rejects %j", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe("assertLocalDatabaseUrl", () => {
  it.each([
    "postgres://krajozbior_auth:secret@localhost:5432/krajozbior",
    "postgres://krajozbior_auth:secret@127.0.0.1:5432/krajozbior",
    "postgresql://krajozbior_auth:secret@[::1]:5432/krajozbior",
  ])("accepts %s", (url) => {
    expect(() => assertLocalDatabaseUrl(url)).not.toThrow();
  });

  it.each([
    "postgres://krajozbior_auth:hunter2@db.prod.example:5432/krajozbior",
    "postgres://krajozbior_auth:hunter2@10.0.0.5:5432/krajozbior",
    "postgres://krajozbior_auth:hunter2@/krajozbior?host=/var/run/postgresql",
    // The pg driver connects to the `host` parameter, not to the authority.
    "postgres://krajozbior_auth:hunter2@localhost/db?host=example.com",
    "postgres://krajozbior_auth:hunter2@localhost:5432/db?host=db.example.com&sslmode=disable",
    "postgres://krajozbior_auth:hunter2@localhost/db?HOST=example.com",
    "postgres://krajozbior_auth:hunter2@localhost/db?host=localhost",
    "postgres://krajozbior_auth:hunter2@127.0.0.1/db?hostaddr=10.0.0.5",
    "postgres://krajozbior_auth:hunter2@localhost/db?%68ost=example.com",
    "postgres://krajozbior_auth:hunter2@localhost,example.com/db",
    // White or control characters (the URL parser strips some of them).
    " postgres://krajozbior_auth:hunter2@localhost/db?host=example.com",
    "\tpostgres://krajozbior_auth:hunter2@localhost/db",
    "postgres://krajozbior_auth:hunter2@localhost/db\n?host=example.com",
    "postgres://krajozbior_auth:hunter2@local\thost/db",
    "postgres://krajozbior_auth:hunter2@localhost/db ",
    "postgres://krajozbior_auth:hunter2@localhost/db\u0000",
    "not a url hunter2",
    "",
    undefined,
  ])("refuses %j without echoing it", (url) => {
    let error: unknown;

    try {
      assertLocalDatabaseUrl(url);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(NonLocalDatabaseError);
    expect((error as Error).message).not.toContain("hunter2");
  });
});
