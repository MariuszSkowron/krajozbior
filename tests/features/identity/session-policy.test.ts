import { describe, expect, it } from "vitest";

import {
  isStaffRole,
  limitSessionExpiry,
  maySignInOnPath,
  PASSWORD_SIGN_IN_PATH,
} from "@/features/identity/domain/session-policy";

const created = new Date("2026-11-16T10:00:00.000Z");
const hours = (n: number) => new Date(created.getTime() + n * 60 * 60 * 1000);

describe("session policy", () => {
  it("treats admin as staff, nothing else", () => {
    expect(isStaffRole("admin")).toBe(true);
    expect(isStaffRole("user")).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });

  it("lets staff sign in only on the password path", () => {
    expect(maySignInOnPath("admin", PASSWORD_SIGN_IN_PATH)).toBe(true);
    expect(maySignInOnPath("admin", "/sign-in/email-otp")).toBe(false);
    expect(maySignInOnPath("admin", "/callback/:id")).toBe(false);
    expect(maySignInOnPath("admin", undefined)).toBe(false);
    expect(maySignInOnPath("user", "/sign-in/email-otp")).toBe(true);
    expect(maySignInOnPath("user", undefined)).toBe(true);
  });

  it("cuts a staff session to 12 hours from its creation", () => {
    expect(limitSessionExpiry("admin", created, hours(24))).toEqual(hours(12));
    expect(limitSessionExpiry("admin", created, hours(13))).toEqual(hours(12));
    expect(limitSessionExpiry("admin", created, hours(1))).toEqual(hours(1));
  });

  it("cuts a user session to 30 days from its creation", () => {
    expect(limitSessionExpiry("user", created, hours(24 * 60))).toEqual(hours(24 * 30));
    expect(limitSessionExpiry("user", created, hours(12))).toEqual(hours(12));
  });

  it("gives an unknown role no session", () => {
    expect(limitSessionExpiry("root", created, hours(1))).toBeNull();
    expect(limitSessionExpiry(undefined, created, hours(1))).toBeNull();
  });
});
