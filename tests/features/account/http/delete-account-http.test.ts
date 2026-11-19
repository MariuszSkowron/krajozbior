import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeleteAccountDeps } from "@/features/account/application/delete-account-types";

const provider = vi.hoisted(() => ({
  getActor: vi.fn(),
  getSessionCreatedAt: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => provider,
}));
vi.mock("@/features/account/infrastructure/delete-account-deps", () => ({
  getDeleteAccountDeps: () => {
    throw new Error("the real dependencies must not be built in a unit test");
  },
}));

const { handleAccountDeletion } = await import("@/features/account/http/delete-account-http");

const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" } as const;
const deleteAccount = vi.fn(async () => undefined);
const deps = {
  withUserContext: async (_a: unknown, work: (tx: never) => Promise<unknown>) => work({} as never),
  isSoleOrganizationMember: async () => false,
  deleteAccount,
  now: () => new Date(),
} as unknown as DeleteAccountDeps;

function post(body: unknown, headers: Record<string, string> = {}) {
  const isForm = typeof body === "string";

  return new Request("http://localhost/api/me/account/deletion", {
    method: "POST",
    headers: {
      "content-type": isForm ? "application/x-www-form-urlencoded" : "application/json",
      ...headers,
    },
    body: isForm ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  deleteAccount.mockResolvedValue(undefined);
  provider.getActor.mockResolvedValue(actor);
  provider.getSessionCreatedAt.mockResolvedValue(new Date());
  provider.signOut.mockResolvedValue(["krajozbior.session_token=; Max-Age=0"]);
});

describe("POST /api/me/account/deletion", () => {
  it("deletes the account and redirects with the cookies cleared", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await handleAccountDeletion(post({ confirmation: "USUŃ" }), deps);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?konto=usuniete");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    // The session cookie and the profile form draft of the shared device (L4).
    expect(response.headers.getSetCookie()).toEqual([
      "krajozbior.session_token=; Max-Age=0",
      "profile-draft=; Path=/my/settings; Max-Age=0; HttpOnly; SameSite=Lax",
    ]);
    expect(deleteAccount).toHaveBeenCalledWith(actor.id);
    // The log line holds the event only: no id, no address.
    expect(info).toHaveBeenCalledWith('{"event":"account.deleted"}');
  });

  it("still redirects when clearing the cookie fails after the deletion", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    provider.signOut.mockRejectedValue(new Error("boom"));

    const response = await handleAccountDeletion(post({ confirmation: "USUŃ" }), deps);

    expect(response.status).toBe(303);
    // The draft is still cleared when the session cookie headers are missing.
    expect(response.headers.getSetCookie()).toEqual([
      "profile-draft=; Path=/my/settings; Max-Age=0; HttpOnly; SameSite=Lax",
    ]);
  });

  it("accepts a native form post", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await handleAccountDeletion(post("confirmation=USU%C5%83"), deps);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?konto=usuniete");
  });

  it("answers a guest 401 whatever the body is", async () => {
    provider.getActor.mockResolvedValue(null);

    for (const body of [{ confirmation: "USUŃ" }, { nonsense: true }]) {
      const response = await handleAccountDeletion(post(body), deps);

      expect(response.status).toBe(401);
    }
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses a body with an account id or without the word (400)", async () => {
    for (const body of [{ confirmation: "USUŃ", userId: actor.id }, {}, null]) {
      const response = await handleAccountDeletion(post(body), deps);

      expect(response.status, JSON.stringify(body)).toBe(400);
    }

    const unreadable = await handleAccountDeletion(
      new Request("http://localhost/api/me/account/deletion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      deps,
    );

    expect(unreadable.status).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("maps the refusals of the use case: 422 wrong word, 409 stale session, 409 administrator", async () => {
    expect((await handleAccountDeletion(post({ confirmation: "tak" }), deps)).status).toBe(422);

    provider.getSessionCreatedAt.mockResolvedValue(new Date(Date.now() - 3_600_000));
    const stale = await handleAccountDeletion(post({ confirmation: "USUŃ" }), deps);

    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "stale_session" });

    provider.getActor.mockResolvedValue({ ...actor, role: "admin" });
    const managed = await handleAccountDeletion(post({ confirmation: "USUŃ" }), deps);

    expect(managed.status).toBe(409);
    expect(await managed.json()).toEqual({ error: "managed_account" });
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("sends a form back to the deletion screen with the reason", async () => {
    const response = await handleAccountDeletion(post("confirmation=nie"), deps);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/my/delete-account?blad=invalid_confirmation");
  });

  it("refuses a cross-origin post before reading the session", async () => {
    const response = await handleAccountDeletion(
      post({ confirmation: "USUŃ" }, { origin: "https://evil.example", host: "app.example" }),
      deps,
    );

    expect(response.status).toBe(403);
    expect(provider.getActor).not.toHaveBeenCalled();
  });

  it("answers 503 without details when the deletion fails, a form gets the screen back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    deleteAccount.mockRejectedValue(new Error("secret detail"));

    const api = await handleAccountDeletion(post({ confirmation: "USUŃ" }), deps);

    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({ error: "unavailable" });

    const form = await handleAccountDeletion(post("confirmation=USU%C5%83"), deps);

    expect(form.status).toBe(303);
    expect(form.headers.get("Location")).toBe("/my/delete-account?blad=unavailable");
  });
});
