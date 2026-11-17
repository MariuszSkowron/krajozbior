import { afterEach, describe, expect, it, vi } from "vitest";

import { logFailure } from "@/lib/log-failure";

afterEach(() => vi.restoreAllMocks());

describe("logFailure", () => {
  it("logs the context and the error class, never the message", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logFailure("Sign-in", new TypeError("password=secret"));

    expect(error).toHaveBeenCalledWith("Sign-in failed:", "TypeError");
  });

  it("does not describe a value that is not an error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logFailure("Sign-out", "secret");

    expect(error).toHaveBeenCalledWith("Sign-out failed:", "unknown error");
  });
});
