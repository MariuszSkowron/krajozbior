import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loginEmailClearCookieHeader,
  loginEmailFromCookie,
  loginEmailSetCookieHeader,
  maskEmail,
} from "@/app/login/login-email-cookie";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("anna@example.com")).toBe("a…@example.com");
    expect(maskEmail("łuk@example.pl")).toBe("ł…@example.pl");
  });

  it("keeps two first and the last character of a longer name", () => {
    expect(maskEmail("łukasz@example.pl")).toBe("łu…z@example.pl");
    expect(maskEmail("magdalena@example.com")).toBe("ma…a@example.com");
  });

  it("switches from one to two visible characters between 5 and 6 characters", () => {
    expect(maskEmail("abcde@example.com")).toBe("a…@example.com");
    expect(maskEmail("abcdef@example.com")).toBe("ab…f@example.com");
  });

  it("masks by the last at sign and returns a malformed value as it is", () => {
    expect(maskEmail("a@b@example.com")).toBe("a…@example.com");
    expect(maskEmail("@example.com")).toBe("@example.com");
    expect(maskEmail("no-at-sign")).toBe("no-at-sign");
  });
});

describe("loginEmailFromCookie", () => {
  it("accepts a well-formed address", () => {
    expect(loginEmailFromCookie("anna@example.com")).toBe("anna@example.com");
  });

  it("treats a missing, empty, malformed or oversized value as no address", () => {
    expect(loginEmailFromCookie(undefined)).toBeNull();
    expect(loginEmailFromCookie("")).toBeNull();
    expect(loginEmailFromCookie("not an address")).toBeNull();
    expect(loginEmailFromCookie(`${"a".repeat(250)}@example.com`)).toBeNull();
  });
});

describe("login e-mail cookie headers", () => {
  it("is short-lived, unreadable by scripts and limited to the login path", () => {
    const header = loginEmailSetCookieHeader("anna@example.com");

    expect(header).toContain("krajozbior_login_email=anna%40example.com");
    expect(header).toContain("Path=/login");
    expect(header).toContain("Max-Age=600");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).not.toContain("Secure");
  });

  it("is Secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(loginEmailSetCookieHeader("anna@example.com")).toContain("; Secure");
    expect(loginEmailClearCookieHeader()).toContain("; Secure");
  });

  it("is removed with an empty value on the same path", () => {
    const header = loginEmailClearCookieHeader();

    expect(header).toContain("krajozbior_login_email=;");
    expect(header).toContain("Path=/login");
    expect(header).toContain("Max-Age=0");
  });
});
