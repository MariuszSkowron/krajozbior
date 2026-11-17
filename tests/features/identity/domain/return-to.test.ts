import { describe, expect, it } from "vitest";

import { requestedReturnTo, safeReturnTo } from "@/features/identity/domain/return-to";

describe("safeReturnTo", () => {
  it.each([
    ["/", "/"],
    ["/api/demo/personal", "/api/demo/personal"],
    ["/login?x=1#top", "/login?x=1#top"],
    ["/a/../b", "/b"],
  ])("keeps the local path %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it.each([
    ["https://evil.example/"],
    ["//evil.example"],
    ["///evil.example"],
    ["/\\evil.example"],
    ["\\\\evil.example"],
    ["javascript:alert(1)"],
    ["relative/path"],
    ["/ok\nSet-Cookie: a=b"],
    ["/ok\u007f"],
    ["/..//evil.example"],
    ["/.//evil.example"],
    ["/a/..//evil.example"],
    ["/%2e%2e//evil.example"],
    [""],
    ["/" + "a".repeat(2048)],
  ])("falls back to / for %j", (input) => {
    expect(safeReturnTo(input)).toBe("/");
  });

  it.each([undefined, null, 5, {}, ["/ok"]])("falls back to / for non-string %j", (input) => {
    expect(safeReturnTo(input)).toBe("/");
  });
});

describe("requestedReturnTo", () => {
  it.each([undefined, ""])("leaves the destination to the role for %j", (input) => {
    expect(requestedReturnTo(input)).toBeNull();
  });

  it("keeps a safe destination", () => {
    expect(requestedReturnTo("/api/demo/personal")).toBe("/api/demo/personal");
  });

  it("falls back to / for a destination that was given but is unsafe", () => {
    expect(requestedReturnTo("//evil.example")).toBe("/");
  });
});
