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
    "postgres://starter_auth:secret@localhost:5432/starter",
    "postgres://starter_auth:secret@127.0.0.1:5432/starter",
    "postgresql://starter_auth:secret@[::1]:5432/starter",
  ])("accepts %s", (url) => {
    expect(() => assertLocalDatabaseUrl(url)).not.toThrow();
  });

  it.each([
    "postgres://starter_auth:hunter2@db.prod.example:5432/starter",
    "postgres://starter_auth:hunter2@10.0.0.5:5432/starter",
    "postgres://starter_auth:hunter2@/starter?host=/var/run/postgresql",
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
