import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security-headers";

const valueOf = (key: string, isDev = false) =>
  securityHeaders(isDev)[0].headers.find((header) => header.key === key)?.value;

describe("security headers", () => {
  it("apply to every path", () => {
    expect(securityHeaders(false).map(({ source }) => source)).toEqual(["/:path*"]);
  });

  it("set all headers required by #67", () => {
    for (const key of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "Permissions-Policy",
      "X-Frame-Options",
    ]) {
      expect(valueOf(key), key).toBeTruthy();
    }

    expect(valueOf("X-Content-Type-Options")).toBe("nosniff");
    expect(valueOf("X-Frame-Options")).toBe("DENY");
    expect(valueOf("Strict-Transport-Security")).toMatch(/^max-age=\d{8,}$/);
  });

  it("forbids framing and foreign origins", () => {
    const csp = contentSecurityPolicy(false);

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).not.toMatch(/https?:|\*/);
  });

  it("allows eval only in development", () => {
    expect(contentSecurityPolicy(false)).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy(true)).toContain("'unsafe-eval'");
  });

  it("sends HSTS only outside development", () => {
    expect(valueOf("Strict-Transport-Security", false)).toBe("max-age=31536000");
    expect(valueOf("Strict-Transport-Security", true)).toBeUndefined();
    expect(valueOf("Content-Security-Policy", true)).toBeTruthy();
  });

  it("is what next.config serves", async () => {
    expect(await nextConfig.headers?.()).toEqual(securityHeaders(false));
  });
});
