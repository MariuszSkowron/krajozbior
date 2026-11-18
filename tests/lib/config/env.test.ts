import { describe, expect, it } from "vitest";

import {
  parseAuthEnv,
  parseMigrationEnv,
  parseServerEnv,
  ServerConfigError,
} from "@/lib/config/env";

describe("parseServerEnv", () => {
  it("accepts a PostgreSQL connection URL", () => {
    const env = parseServerEnv({
      DATABASE_URL: "postgres://krajozbior:secret@localhost:5432/krajozbior",
    });

    expect(env.DATABASE_URL).toBe("postgres://krajozbior:secret@localhost:5432/krajozbior");
  });

  it("names the missing variable without echoing any value", () => {
    const error = getError(() => parseServerEnv({}));

    expect(error).toBeInstanceOf(ServerConfigError);
    expect(error.message).toBe("Invalid server configuration: DATABASE_URL");
  });

  it("rejects a non-PostgreSQL URL and does not include it in the message", () => {
    const value = "mysql://user:hunter2@db.internal/krajozbior";
    const error = getError(() => parseServerEnv({ DATABASE_URL: value }));

    expect(error).toBeInstanceOf(ServerConfigError);
    expect(error.message).not.toContain("hunter2");
    expect(error.message).not.toContain("db.internal");
  });
});

describe("parseAuthEnv", () => {
  const secret = "s".repeat(32);
  const DATABASE_AUTH_URL = "postgres://krajozbior_auth:secret@localhost:5432/krajozbior";

  it("reads the global daily limit of sign-in codes as a positive whole number", () => {
    const base = { DATABASE_AUTH_URL, BETTER_AUTH_SECRET: secret };

    expect(parseAuthEnv({ ...base, OTP_GLOBAL_DAILY_LIMIT: "500" }).OTP_GLOBAL_DAILY_LIMIT).toBe(
      500,
    );
    expect(parseAuthEnv(base).OTP_GLOBAL_DAILY_LIMIT).toBeUndefined();
    for (const value of ["0", "-1", "1.5", "abc", "99999999"]) {
      expect(() => parseAuthEnv({ ...base, OTP_GLOBAL_DAILY_LIMIT: value })).toThrow(
        ServerConfigError,
      );
    }
  });

  it("accepts the auth connection and a long enough secret with an optional base URL", () => {
    expect(parseAuthEnv({ DATABASE_AUTH_URL, BETTER_AUTH_SECRET: secret })).toEqual({
      DATABASE_AUTH_URL,
      BETTER_AUTH_SECRET: secret,
    });
    expect(
      parseAuthEnv({
        DATABASE_AUTH_URL,
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: "https://krajozbior.example",
      }),
    ).toMatchObject({ BETTER_AUTH_URL: "https://krajozbior.example" });
  });

  it("requires its own auth connection instead of falling back to DATABASE_URL", () => {
    const error = getError(() =>
      parseAuthEnv({
        DATABASE_URL: "postgres://krajozbior_app:secret@localhost:5432/krajozbior",
        BETTER_AUTH_SECRET: secret,
      }),
    );

    expect(error.message).toBe("Invalid server configuration: DATABASE_AUTH_URL");
  });

  it("names a missing or short secret without echoing its value", () => {
    const missing = getError(() => parseAuthEnv({ DATABASE_AUTH_URL }));
    const short = getError(() =>
      parseAuthEnv({ DATABASE_AUTH_URL, BETTER_AUTH_SECRET: "too-short-hunter2" }),
    );

    expect(missing.message).toBe("Invalid server configuration: BETTER_AUTH_SECRET");
    expect(short.message).toBe("Invalid server configuration: BETTER_AUTH_SECRET");
    expect(short.message).not.toContain("hunter2");
  });

  it("rejects a base URL that is not http(s)", () => {
    const error = getError(() =>
      parseAuthEnv({
        DATABASE_AUTH_URL,
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: "ftp://krajozbior.example",
      }),
    );

    expect(error.message).toBe("Invalid server configuration: BETTER_AUTH_URL");
  });
});

describe("parseAuthEnv in production (issue #39)", () => {
  const base = {
    NODE_ENV: "production",
    DATABASE_AUTH_URL: "postgres://krajozbior_auth:secret@db.internal:5432/krajozbior",
    BETTER_AUTH_SECRET: "s".repeat(32),
  };

  it("rejects an http address, which would drop the Secure cookie attribute", () => {
    const error = getError(() =>
      parseAuthEnv({
        ...base,
        BETTER_AUTH_URL: "http://krajozbior.example",
        AUTH_CLIENT_IP_HEADER: "x-real-ip",
      }),
    );

    expect(error).toBeInstanceOf(ServerConfigError);
    expect(error.message).toBe("Invalid server configuration: BETTER_AUTH_URL");
  });

  it("requires the public address", () => {
    expect(getError(() => parseAuthEnv(base)).message).toBe(
      "Invalid server configuration: BETTER_AUTH_URL",
    );
  });

  it("requires the client-IP header for a public address", () => {
    const error = getError(() =>
      parseAuthEnv({ ...base, BETTER_AUTH_URL: "https://krajozbior.example" }),
    );

    expect(error.message).toBe("Invalid server configuration: AUTH_CLIENT_IP_HEADER");
  });

  it("accepts https with a client-IP header", () => {
    expect(
      parseAuthEnv({
        ...base,
        BETTER_AUTH_URL: "https://krajozbior.example",
        AUTH_CLIENT_IP_HEADER: "cf-connecting-ip",
      }),
    ).toMatchObject({
      BETTER_AUTH_URL: "https://krajozbior.example",
      AUTH_CLIENT_IP_HEADER: "cf-connecting-ip",
    });
  });

  it.each(["http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"])(
    "allows a local production build over %s",
    (url) => {
      expect(parseAuthEnv({ ...base, BETTER_AUTH_URL: url })).toMatchObject({
        BETTER_AUTH_URL: url,
      });
    },
  );

  it("keeps http allowed outside production", () => {
    expect(
      parseAuthEnv({
        ...base,
        NODE_ENV: "development",
        BETTER_AUTH_URL: "http://krajozbior.example",
      }),
    ).toMatchObject({ BETTER_AUTH_URL: "http://krajozbior.example" });
  });

  it("rejects an unsupported client-IP header", () => {
    const error = getError(() =>
      parseAuthEnv({
        ...base,
        BETTER_AUTH_URL: "https://krajozbior.example",
        AUTH_CLIENT_IP_HEADER: "forwarded",
      }),
    );

    expect(error.message).toBe("Invalid server configuration: AUTH_CLIENT_IP_HEADER");
  });
});

describe("parseMigrationEnv", () => {
  it("reads only the migration connection", () => {
    const url = "postgres://krajozbior_owner:secret@localhost:5432/krajozbior";

    expect(parseMigrationEnv({ DATABASE_MIGRATION_URL: url })).toEqual({
      DATABASE_MIGRATION_URL: url,
    });
    expect(getError(() => parseMigrationEnv({ DATABASE_URL: url })).message).toBe(
      "Invalid server configuration: DATABASE_MIGRATION_URL",
    );
  });
});

function getError(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) return error;
  }

  throw new Error("Expected the action to throw an Error");
}
