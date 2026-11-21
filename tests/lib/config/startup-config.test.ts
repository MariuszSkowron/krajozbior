import { afterEach, describe, expect, it, vi } from "vitest";

import { assertStartupConfig, ServerConfigError } from "@/lib/config/env";
import { register } from "@/instrumentation";

// OPS-8 and E11 5.5: a production server with a missing or wrong setting does
// not start; it does not wait for the first sign-in to fail.
const KEY = "xkeysib-test-only-0123456789abcdef";
const server = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://krajozbior_app:secret@db:5432/krajozbior",
  DATABASE_AUTH_URL: "postgres://krajozbior_auth:secret@db:5432/krajozbior",
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "https://krajozbior.example",
  AUTH_CLIENT_IP_HEADER: "x-real-ip",
  EMAIL_TRANSPORT: "brevo",
  BREVO_API_KEY: KEY,
  EMAIL_FROM: "noreply@krajozbior.example",
};

function getError(action: () => unknown): ServerConfigError {
  try {
    action();
  } catch (error) {
    if (error instanceof ServerConfigError) return error;
  }

  throw new Error("Expected a ServerConfigError");
}

describe("assertStartupConfig", () => {
  it("accepts a complete server configuration with Brevo", () => {
    expect(() => assertStartupConfig(server)).not.toThrow();
  });

  it("refuses to start in production without the Brevo key", () => {
    const error = getError(() => assertStartupConfig({ ...server, BREVO_API_KEY: undefined }));

    expect(error.message).toBe("Invalid server configuration: BREVO_API_KEY");
  });

  it("refuses to start in production without an e-mail transport", () => {
    const error = getError(() => assertStartupConfig({ ...server, EMAIL_TRANSPORT: undefined }));

    expect(error.invalidNames).toContain("EMAIL_TRANSPORT");
  });

  it("names every wrong variable of the database, sign-in and e-mail at once, never a value", () => {
    const error = getError(() =>
      assertStartupConfig({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "too-short-hunter2",
        EMAIL_TRANSPORT: "brevo",
        BREVO_API_KEY: "short",
      }),
    );

    expect(error.invalidNames).toEqual(
      expect.arrayContaining([
        "DATABASE_URL",
        "DATABASE_AUTH_URL",
        "BETTER_AUTH_SECRET",
        "BREVO_API_KEY",
        "EMAIL_FROM",
      ]),
    );
    expect(error.message).not.toContain("hunter2");
  });

  it("refuses the local outbox on a public production address", () => {
    const error = getError(() =>
      assertStartupConfig({ ...server, EMAIL_TRANSPORT: "outbox", BREVO_API_KEY: undefined }),
    );

    expect(error.invalidNames).toEqual(["EMAIL_TRANSPORT"]);
  });

  it("checks nothing outside production (development, tests)", () => {
    expect(() => assertStartupConfig({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertStartupConfig({})).not.toThrow();
  });
});

describe("instrumentation register", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubServer(env: Record<string, string | undefined>) {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  }

  it("stops a production Node.js server that has no Brevo key", async () => {
    stubServer({ ...server, BREVO_API_KEY: undefined, NEXT_RUNTIME: "nodejs" });

    await expect(register()).rejects.toThrow("Invalid server configuration: BREVO_API_KEY");
  });

  it("lets a complete production server start", async () => {
    stubServer({ ...server, NEXT_RUNTIME: "nodejs" });

    await expect(register()).resolves.toBeUndefined();
  });

  it("does nothing in the edge runtime", async () => {
    stubServer({ ...server, BREVO_API_KEY: undefined, NEXT_RUNTIME: "edge" });

    await expect(register()).resolves.toBeUndefined();
  });
});
