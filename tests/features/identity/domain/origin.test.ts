import { describe, expect, it } from "vitest";

import { isSameOrigin } from "@/features/identity/domain/origin";

describe("isSameOrigin", () => {
  it("allows requests without an Origin header", () => {
    expect(isSameOrigin(null, "app.example")).toBe(true);
  });

  it("allows an Origin that matches the host", () => {
    expect(isSameOrigin("https://app.example", "app.example")).toBe(true);
    expect(isSameOrigin("http://127.0.0.1:3000", "127.0.0.1:3000")).toBe(true);
  });

  it("rejects a different host or port", () => {
    expect(isSameOrigin("https://evil.example", "app.example")).toBe(false);
    expect(isSameOrigin("http://127.0.0.1:3001", "127.0.0.1:3000")).toBe(false);
  });

  it("rejects an Origin when the host is unknown", () => {
    expect(isSameOrigin("https://app.example", null)).toBe(false);
  });

  it("rejects an unparsable Origin such as the opaque 'null'", () => {
    expect(isSameOrigin("null", "app.example")).toBe(false);
  });
});
