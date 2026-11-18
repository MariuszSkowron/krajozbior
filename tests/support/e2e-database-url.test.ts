import { describe, expect, it } from "vitest";

import { parseE2eAdminDatabaseUrl } from "./e2e-database-url";

describe("parseE2eAdminDatabaseUrl", () => {
  it("accepts the disposable E2E database on localhost, on any port", () => {
    for (const url of [
      "postgres://u:p@localhost:5432/krajozbior_e2e",
      "postgres://u:p@127.0.0.1:55540/krajozbior_e2e",
    ]) {
      expect(parseE2eAdminDatabaseUrl(url)).toBe(url);
    }
  });

  it("refuses the developer database on port 5432", () => {
    expect(() => parseE2eAdminDatabaseUrl("postgres://u:p@127.0.0.1:5432/krajozbior")).toThrow(
      /krajozbior_e2e/,
    );
  });

  it("refuses a remote host, a missing value and a non-postgres address", () => {
    expect(() =>
      parseE2eAdminDatabaseUrl("postgres://u:p@db.example.com/krajozbior_e2e"),
    ).toThrow();
    expect(() => parseE2eAdminDatabaseUrl(undefined)).toThrow();
    expect(() => parseE2eAdminDatabaseUrl("http://localhost/krajozbior_e2e")).toThrow();
  });

  it("does not leak the password in the message", () => {
    let message = "";

    try {
      parseE2eAdminDatabaseUrl("postgres://u:secretpw@127.0.0.1:5432/krajozbior");
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("secretpw");
  });
});
