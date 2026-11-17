import { describe, expect, it } from "vitest";

import {
  AuthenticationRequiredError,
  ForbiddenError,
  isRole,
  requireActor,
  requireRole,
  roles,
  type Actor,
} from "@/features/identity/domain/actor";

const user: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };
const admin: Actor = { id: "33333333-3333-4333-8333-333333333333", role: "admin" };

describe("isRole", () => {
  it("accepts exactly the product roles", () => {
    expect(roles.every(isRole)).toBe(true);
  });

  it.each(["guest", "ADMIN", "", null, undefined, 1, {}])("rejects %j", (value) => {
    expect(isRole(value)).toBe(false);
  });
});

describe("requireActor", () => {
  it("returns a signed-in actor", () => {
    expect(requireActor(user)).toBe(user);
  });

  it("requires authentication for a guest", () => {
    expect(() => requireActor(null)).toThrow(AuthenticationRequiredError);
  });
});

describe("requireRole", () => {
  it("returns the actor when the role is allowed", () => {
    expect(requireRole(admin, "admin")).toBe(admin);
    expect(requireRole(admin, "user", "admin")).toBe(admin);
  });

  it("requires authentication before checking the role", () => {
    expect(() => requireRole(null, "admin")).toThrow(AuthenticationRequiredError);
  });

  it("forbids a user from an admin action", () => {
    expect(() => requireRole(user, "admin")).toThrow(ForbiddenError);
  });

  it("does not let admin inherit user rights", () => {
    expect(() => requireRole(admin, "user")).toThrow(ForbiddenError);
  });

  it("forbids everyone when no role is allowed", () => {
    expect(() => requireRole(admin)).toThrow(ForbiddenError);
  });
});

describe("errors", () => {
  it("carry stable names and no details", () => {
    expect(new AuthenticationRequiredError()).toMatchObject({
      name: "AuthenticationRequiredError",
      message: "Authentication required",
    });
    expect(new ForbiddenError()).toMatchObject({ name: "ForbiddenError", message: "Forbidden" });
  });
});
