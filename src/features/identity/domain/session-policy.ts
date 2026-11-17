import { isRole, type Role } from "./actor";

// Session limits by role: a user stays signed in for up to 30 days from sign-in,
// an admin for 12 hours. The limit is absolute: it counts from the creation of
// the session, never from its last use.
const HOUR_MS = 60 * 60 * 1000;

export const SESSION_LIMIT_MS: Readonly<Record<Role, number>> = {
  user: 30 * 24 * HOUR_MS,
  admin: 12 * HOUR_MS,
};

// Admin accounts sign in only with a password: never with a sign-in code.
export function isStaffRole(role: unknown): boolean {
  return role === "admin";
}

// Better Auth path of the password sign-in endpoint; the only path on which a
// staff session may be created.
export const PASSWORD_SIGN_IN_PATH = "/sign-in/email";

export function maySignInOnPath(role: unknown, path: string | undefined): boolean {
  return !isStaffRole(role) || path === PASSWORD_SIGN_IN_PATH;
}

/**
 * The expiry a session may have: the requested one, cut to the role's limit
 * counted from the session's creation. `null` for an unknown role, which gets
 * no session at all.
 */
export function limitSessionExpiry(role: unknown, createdAt: Date, requested: Date): Date | null {
  if (!isRole(role)) {
    return null;
  }

  const limit = createdAt.getTime() + SESSION_LIMIT_MS[role];

  return new Date(Math.min(requested.getTime(), limit));
}
