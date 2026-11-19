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

  it("allows geolocation for the own origin only (the visit button of PR7), and no other device", () => {
    const policy = valueOf("Permissions-Policy");

    expect(policy).toContain("geolocation=(self)");
    expect(policy).toContain("camera=()");
    expect(policy).toContain("microphone=()");
  });

  it("forbids framing and foreign origins", () => {
    const csp = contentSecurityPolicy(false);

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("font-src 'self'");
    // The one foreign host: the tiles of the collection map (E12-5, D-35), in img-src only.
    expect(csp.match(/https?:\/\/[^\s;]+/g)).toEqual(["https://tile.openstreetmap.org"]);
    expect(csp).not.toContain("*");
  });

  it("lets the collection map load tiles from one host and sends the referer to it (E12-5)", () => {
    expect(contentSecurityPolicy(false)).toContain(
      "img-src 'self' data: blob: https://tile.openstreetmap.org;",
    );
    expect(contentSecurityPolicy(false)).toContain("connect-src 'self';");
    // The tile server refuses requests without a Referer: never tighten this to no-referrer.
    expect(valueOf("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
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
