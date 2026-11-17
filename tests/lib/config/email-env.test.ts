import { describe, expect, it } from "vitest";

import {
  DEV_EMAIL_FROM,
  isSafeOutboxDir,
  parseEmailEnv,
  ServerConfigError,
} from "@/lib/config/env";

describe("parseEmailEnv ", () => {
  it("defaults to the outbox with a git-ignored directory outside production", () => {
    expect(parseEmailEnv({})).toEqual({
      EMAIL_TRANSPORT: "outbox",
      EMAIL_OUTBOX_DIR: ".data/email-outbox",
      EMAIL_FROM: DEV_EMAIL_FROM,
    });
  });

  it("accepts the outbox on a loopback address", () => {
    expect(
      parseEmailEnv({
        EMAIL_TRANSPORT: "outbox",
        EMAIL_OUTBOX_DIR: ".data/tmp-outbox",
        EMAIL_FROM: "a@krajozbior.local",
        BETTER_AUTH_URL: "http://localhost:3000",
      }),
    ).toEqual({
      EMAIL_TRANSPORT: "outbox",
      EMAIL_OUTBOX_DIR: ".data/tmp-outbox",
      EMAIL_FROM: "a@krajozbior.local",
    });
  });

  it.each(["https://krajozbior.example", "http://192.168.1.10:3000", "http://staging.example"])(
    "refuses the outbox for the non-local address %s",
    (url) => {
      const error = getError(() =>
        parseEmailEnv({ EMAIL_TRANSPORT: "outbox", BETTER_AUTH_URL: url }),
      );

      expect(error).toBeInstanceOf(ServerConfigError);
      expect(error.message).toBe("Invalid server configuration: EMAIL_TRANSPORT");
    },
  );

  it("refuses the outbox for an unparsable address", () => {
    expect(() => parseEmailEnv({ BETTER_AUTH_URL: "not a url" })).toThrow(ServerConfigError);
  });

  it("requires a transport and a sender in production", () => {
    const error = getError(() => parseEmailEnv({ NODE_ENV: "production" }));

    expect(error.message).toContain("EMAIL_TRANSPORT");
  });

  it("refuses the outbox in production without the test flag, even on loopback", () => {
    expect(() =>
      parseEmailEnv({
        NODE_ENV: "production",
        EMAIL_TRANSPORT: "outbox",
        EMAIL_FROM: "a@krajozbior.local",
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
      }),
    ).toThrow(ServerConfigError);
  });

  it("refuses the outbox in production with the flag but without a loopback address", () => {
    const base = {
      NODE_ENV: "production",
      EMAIL_TRANSPORT: "outbox",
      EMAIL_FROM: "a@krajozbior.local",
      EMAIL_OUTBOX_TEST_ONLY: "1",
    };

    expect(() => parseEmailEnv(base)).toThrow(ServerConfigError);
    expect(() => parseEmailEnv({ ...base, BETTER_AUTH_URL: "https://krajozbior.example" })).toThrow(
      ServerConfigError,
    );
  });

  it("accepts the outbox in a local production test build (flag and loopback)", () => {
    expect(
      parseEmailEnv({
        NODE_ENV: "production",
        EMAIL_TRANSPORT: "outbox",
        EMAIL_FROM: "a@krajozbior.local",
        EMAIL_OUTBOX_TEST_ONLY: "1",
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
      }).EMAIL_TRANSPORT,
    ).toBe("outbox");
  });

  it("rejects an unknown transport and a malformed sender without echoing values", () => {
    const transport = getError(() => parseEmailEnv({ EMAIL_TRANSPORT: "smtp-secret" }));
    const from = getError(() => parseEmailEnv({ EMAIL_FROM: "not-an-address" }));

    expect(transport.message).toBe("Invalid server configuration: EMAIL_TRANSPORT");
    expect(transport.message).not.toContain("smtp-secret");
    expect(from.message).toBe("Invalid server configuration: EMAIL_FROM");
  });
});

describe("EMAIL_OUTBOX_DIR", () => {
  it.each([".data/email-outbox", ".data/a/b", "./.data/x", ".data\\x"])("accepts %s", (dir) => {
    expect(isSafeOutboxDir(dir)).toBe(true);
  });

  it.each([
    "/tmp/outbox",
    "C:\\outbox",
    "\\\\server\\share",
    "../.data/x",
    ".data/../public/x",
    ".data/../../x",
    "public/outbox",
    "email-outbox",
    ".data",
    ".data/x\u0000y",
    "",
  ])("refuses %j", (dir) => {
    expect(isSafeOutboxDir(dir)).toBe(false);
  });

  it("reports the variable name when the directory is refused", () => {
    const error = getError(() => parseEmailEnv({ EMAIL_OUTBOX_DIR: "public/mail" }));

    expect(error.message).toBe("Invalid server configuration: EMAIL_OUTBOX_DIR");
  });
});

describe("EMAIL_TRANSPORT=memory", () => {
  const base = { EMAIL_TRANSPORT: "memory", EMAIL_FROM: "a@krajozbior.local" };

  it("is accepted outside production and on a loopback address", () => {
    expect(parseEmailEnv(base).EMAIL_TRANSPORT).toBe("memory");
    expect(
      parseEmailEnv({ ...base, BETTER_AUTH_URL: "http://localhost:3000" }).EMAIL_TRANSPORT,
    ).toBe("memory");
  });

  it("is refused for a non-local address", () => {
    expect(() => parseEmailEnv({ ...base, BETTER_AUTH_URL: "https://krajozbior.example" })).toThrow(
      ServerConfigError,
    );
  });

  it("is refused in production without the test flag and loopback address", () => {
    const production = { ...base, NODE_ENV: "production" };

    expect(() => parseEmailEnv(production)).toThrow(ServerConfigError);
    expect(() =>
      parseEmailEnv({ ...production, BETTER_AUTH_URL: "http://127.0.0.1:3100" }),
    ).toThrow(ServerConfigError);
    expect(() => parseEmailEnv({ ...production, EMAIL_OUTBOX_TEST_ONLY: "1" })).toThrow(
      ServerConfigError,
    );
    expect(
      parseEmailEnv({
        ...production,
        EMAIL_OUTBOX_TEST_ONLY: "1",
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
      }).EMAIL_TRANSPORT,
    ).toBe("memory");
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
