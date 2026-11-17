// Roles of the krajozbior: every signed-in account is a `user`; `admin` exists so
// that the role checks (403 for a signed-in actor without the role) have a
// real case. Add product roles here and in the auth.users check constraint.
export const roles = ["user", "admin"] as const;

export type Role = (typeof roles)[number];

export type Actor = { id: string; role: Role };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (roles as readonly string[]).includes(value);
}

// Raised when an operation needs a signed-in actor and the request has none.
export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthenticationRequiredError";
  }
}

// Raised when the actor is signed in but their role does not allow the operation.
export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

export function requireActor(actor: Actor | null): Actor {
  if (actor === null) {
    throw new AuthenticationRequiredError();
  }

  return actor;
}

// Roles never inherit from each other: an operation names every allowed role.
export function requireRole(actor: Actor | null, ...allowed: Role[]): Actor {
  const signedIn = requireActor(actor);

  if (!allowed.includes(signedIn.role)) {
    throw new ForbiddenError();
  }

  return signedIn;
}
