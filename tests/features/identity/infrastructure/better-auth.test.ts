import { describe, expect, it, vi } from "vitest";

import {
  BetterAuthIdentityProvider,
  type Auth,
} from "@/features/identity/infrastructure/better-auth";

const userId = "11111111-1111-4111-8111-111111111111";

function providerWith(api: Record<string, unknown>) {
  return new BetterAuthIdentityProvider(() => ({ api }) as unknown as Auth);
}

function signInResponse(status: number, body: unknown, cookies: string[] = []) {
  const headers = new Headers();

  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }

  return new Response(JSON.stringify(body), { status, headers });
}

describe("BetterAuthIdentityProvider.getActor", () => {
  it("maps the session user to an actor", async () => {
    const getSession = vi.fn().mockResolvedValue({ user: { id: userId, role: "admin" } });
    const headers = new Headers({ cookie: "krajozbior.session_token=x" });

    expect(await providerWith({ getSession }).getActor(headers)).toEqual({
      id: userId,
      role: "admin",
    });
    expect(getSession).toHaveBeenCalledWith({ headers });
  });

  it("returns null without a session", async () => {
    const provider = providerWith({ getSession: vi.fn().mockResolvedValue(null) });

    expect(await provider.getActor(new Headers())).toBeNull();
  });

  it("returns null for an unknown stored role instead of guessing one", async () => {
    const provider = providerWith({
      getSession: vi.fn().mockResolvedValue({ user: { id: userId, role: "superuser" } }),
    });

    expect(await provider.getActor(new Headers())).toBeNull();
  });
});

describe("BetterAuthIdentityProvider.signIn", () => {
  const credentials = { email: "user@demo.krajozbior.local", password: "secret-password" };

  it("returns the actor and the session cookies", async () => {
    const signInEmail = vi
      .fn()
      .mockResolvedValue(
        signInResponse(200, { user: { id: userId, role: "user" } }, [
          "krajozbior.session_token=abc",
        ]),
      );

    const result = await providerWith({ signInEmail }).signIn(credentials, new Headers());

    expect(result).toEqual({
      actor: { id: userId, role: "user" },
      setCookies: ["krajozbior.session_token=abc"],
    });
  });

  it("returns null for rejected credentials", async () => {
    const signInEmail = vi.fn().mockResolvedValue(signInResponse(401, { code: "INVALID" }));

    expect(await providerWith({ signInEmail }).signIn(credentials, new Headers())).toBeNull();
  });

  it("throws on provider failure instead of reporting wrong credentials", async () => {
    const signInEmail = vi.fn().mockResolvedValue(signInResponse(500, {}));

    await expect(providerWith({ signInEmail }).signIn(credentials, new Headers())).rejects.toThrow(
      "status 500",
    );
  });

  it("throws on a successful response without a valid actor", async () => {
    const signInEmail = vi
      .fn()
      .mockResolvedValue(signInResponse(200, { user: { id: userId, role: "superuser" } }));

    await expect(providerWith({ signInEmail }).signIn(credentials, new Headers())).rejects.toThrow(
      "valid actor",
    );
  });

  it("throws on a non-error, non-OK status", async () => {
    const signInEmail = vi.fn().mockResolvedValue(signInResponse(302, {}));

    await expect(providerWith({ signInEmail }).signIn(credentials, new Headers())).rejects.toThrow(
      "status 302",
    );
  });
});

describe("BetterAuthIdentityProvider.signOut", () => {
  const session = { user: { id: userId, role: "user" } };

  it("returns the cookies that clear the session once it is gone", async () => {
    const getSession = vi.fn().mockResolvedValueOnce(session).mockResolvedValueOnce(null);
    const signOut = vi
      .fn()
      .mockResolvedValue(
        signInResponse(200, { success: true }, ["krajozbior.session_token=; Max-Age=0"]),
      );

    expect(await providerWith({ getSession, signOut }).signOut(new Headers())).toEqual([
      "krajozbior.session_token=; Max-Age=0",
    ]);
  });

  it("succeeds when there is no session to end", async () => {
    const getSession = vi.fn().mockResolvedValue(null);
    const signOut = vi.fn().mockRejectedValue(new Error("no session"));

    expect(await providerWith({ getSession, signOut }).signOut(new Headers())).toEqual([]);
  });

  it("fails when the session survives sign-out, instead of reporting success", async () => {
    const getSession = vi.fn().mockResolvedValue(session);
    const signOut = vi.fn().mockResolvedValue(signInResponse(200, { success: true }, ["a=b"]));

    await expect(providerWith({ getSession, signOut }).signOut(new Headers())).rejects.toThrow(
      "still active",
    );
  });
});
