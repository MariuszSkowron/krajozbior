import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "@/proxy";

const at = (path: string) => proxy(new NextRequest(`http://127.0.0.1:3000${path}`));

// Every page carries the shell drawn for the signed-in role.
describe("proxy coverage and caching", () => {
  it.each([
    "/",
    "/about",
    "/login",
    "/login?returnTo=%2Fmy",
    "/my",
    "/nie-ma-takiej-strony",
    "/apiary",
    // A page path with a dot is still a page: it must not leave shared caches open.
    "/u/jan.kowalski",
    "/raport.2026",
  ])("runs on the page %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each([
    "/api/health",
    "/api/auth/logout",
    "/api",
    "/_next/static/chunks/main.js",
    "/_next/image?url=%2Fx.png",
    "/favicon.ico",
    "/next.svg",
    "/robots.txt",
    "/fonts/inter.woff2",
  ])("skips %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });

  it.each(["/", "/about", "/login", "/my", "/nie-ma-takiej-strony"])(
    "keeps %s out of shared caches and lets it through",
    (path) => {
      const response = at(path);

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );

  it("does not set the security headers, which come from next.config.ts", () => {
    const response = at("/");

    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("x-frame-options")).toBeNull();
  });
});
