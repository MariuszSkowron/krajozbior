import { describe, expect, it } from "vitest";

import { authorizeRequest } from "@/features/identity/application/authorize";
import type { Actor } from "@/features/identity/domain/actor";
import type { IdentityProvider } from "@/features/identity/domain/identity-provider";

function providerFor(actor: Actor | null | Error): IdentityProvider {
  return {
    getActor: async () => {
      if (actor instanceof Error) {
        throw actor;
      }

      return actor;
    },
    signIn: async () => null,
    requestSignInCode: async () => undefined,
    signInWithCode: async () => null,
    signOut: async () => [],
    getSessionCreatedAt: async () => null,
    getSessionEmail: async () => null,
    deleteAccount: async () => false,
  };
}

const user: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };
const admin: Actor = { id: "22222222-2222-4222-8222-222222222222", role: "admin" };

function request(accept?: string) {
  return new Request("https://app.example/api/admin?x=1", {
    headers: accept ? { accept } : {},
  });
}

describe("authorizeRequest", () => {
  it("returns the actor for any role when none is required", async () => {
    expect(await authorizeRequest(request(), providerFor(user))).toEqual({ actor: user });
  });

  it("returns the actor when the role is allowed", async () => {
    expect(await authorizeRequest(request(), providerFor(admin), "admin")).toEqual({
      actor: admin,
    });
  });

  it("answers API clients without a session with 401", async () => {
    const result = await authorizeRequest(request("application/json"), providerFor(null));

    expect(result).toHaveProperty("response");
    const { response } = result as { response: Response };
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("answers requests with no Accept header without a session with 401", async () => {
    const { response } = (await authorizeRequest(request(), providerFor(null))) as {
      response: Response;
    };

    expect(response.status).toBe(401);
  });

  it("sends browser navigation without a session to login with a safe returnTo", async () => {
    const { response } = (await authorizeRequest(
      request("text/html,application/xhtml+xml"),
      providerFor(null),
      "admin",
    )) as { response: Response };

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/login?returnTo=%2Fapi%2Fadmin%3Fx%3D1");
  });

  it("forbids an user on a admin action", async () => {
    const { response } = (await authorizeRequest(
      request("text/html"),
      providerFor(user),
      "admin",
    )) as { response: Response };

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("does not hide provider failures as authorization results", async () => {
    await expect(
      authorizeRequest(request(), providerFor(new Error("database down"))),
    ).rejects.toThrow("database down");
  });
});
