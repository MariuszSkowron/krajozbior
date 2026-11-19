import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileDeps } from "@/features/profile/application/profile-types";

const provider = vi.hoisted(() => ({ getActor: vi.fn() }));

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => provider,
}));
vi.mock("@/features/profile/infrastructure/profile-deps", () => ({
  getProfileDeps: () => {
    throw new Error("the real dependencies must not be built in a unit test");
  },
}));

const { handleProfileSave } = await import("@/features/profile/http/profile-http");

const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" } as const;
const body = { firstName: "Anna", familyInitial: "K", region: "pomorskie", visibility: "public" };
const save = vi.fn(async (_tx: unknown, profile: unknown) => profile);
const reserve = vi.fn(
  async () => ({ allowed: true }) as { allowed: boolean; retryAfterSeconds?: number },
);
const deps = {
  withUserContext: async (_a: unknown, work: (tx: never) => Promise<unknown>) => work({} as never),
  limiter: { reserve },
  repository: { read: async () => null, save },
} as unknown as ProfileDeps;

function request(payload: unknown, headers: Record<string, string> = {}, method = "PUT") {
  return new Request("http://localhost/api/me/profile", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const form = (payload: string) =>
  request(payload, { "content-type": "application/x-www-form-urlencoded" }, "POST");

beforeEach(() => {
  vi.restoreAllMocks();
  save.mockClear();
  reserve.mockReset();
  reserve.mockResolvedValue({ allowed: true });
  provider.getActor.mockReset();
  provider.getActor.mockResolvedValue(actor);
});

describe("handleProfileSave", () => {
  it("saves a JSON body and answers 200 with the profile, never cached", async () => {
    const response = await handleProfileSave(request(body), deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(body);
    expect(save).toHaveBeenCalledOnce();
  });

  it("refuses a request from another origin before anything else (403)", async () => {
    const response = await handleProfileSave(
      request(body, { origin: "http://evil.example" }),
      deps,
    );

    expect(response.status).toBe(403);
    expect(provider.getActor).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("answers a guest 401 whatever the body is, without reading it", async () => {
    provider.getActor.mockResolvedValue(null);

    for (const payload of [body, "{", { nonsense: true }]) {
      const response = await handleProfileSave(request(payload), deps);

      expect(response.status).toBe(401);
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("answers 400 with the wrong fields, also for a body that is not JSON", async () => {
    const wrong = await handleProfileSave(request({ ...body, region: "x" }), deps);

    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "invalid", fields: ["region"] });

    const named = await handleProfileSave(request({ ...body, userId: actor.id }), deps);

    expect(named.status).toBe(400);

    const unreadable = await handleProfileSave(request("{"), deps);

    expect(unreadable.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it("answers 413 for a body that is too large", async () => {
    const response = await handleProfileSave(
      request({ ...body, firstName: "A".repeat(5000) }),
      deps,
    );

    expect(response.status).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After when the limit is reached", async () => {
    reserve.mockResolvedValue({ allowed: false, retryAfterSeconds: 12 });

    const response = await handleProfileSave(request(body), deps);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(save).not.toHaveBeenCalled();
  });

  it("answers 503 without details when something fails, and logs it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    provider.getActor.mockRejectedValue(new Error("secret detail"));

    const response = await handleProfileSave(request(body), deps);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(error).toHaveBeenCalled();
  });

  it("accepts a native form post and redirects back to the settings", async () => {
    const response = await handleProfileSave(
      form("firstName=Anna&familyInitial=K&region=pomorskie&visibility=public"),
      deps,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/my/settings?profil=zapisano#profil");
    expect(save).toHaveBeenCalledOnce();
  });

  it("sends a form with wrong fields back with the field names, and does not save", async () => {
    const response = await handleProfileSave(
      form("firstName=Anna2&familyInitial=&region=&visibility=public"),
      deps,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/my/settings?profil=blad&pola=firstName#profil");
    expect(save).not.toHaveBeenCalled();
  });

  it("sends a form back for a limit, a large body and a failure; a guest still gets 401", async () => {
    reserve.mockResolvedValue({ allowed: false, retryAfterSeconds: 3 });
    expect(
      (await handleProfileSave(form("visibility=private"), deps)).headers.get("Location"),
    ).toBe("/my/settings?profil=limit#profil");

    reserve.mockResolvedValue({ allowed: true });
    expect(
      (await handleProfileSave(form(`firstName=${"A".repeat(5000)}`), deps)).headers.get(
        "Location",
      ),
    ).toBe("/my/settings?profil=blad#profil");

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    provider.getActor.mockRejectedValue(new Error("boom"));
    expect(
      (await handleProfileSave(form("visibility=private"), deps)).headers.get("Location"),
    ).toBe("/my/settings?profil=niedostepny#profil");

    provider.getActor.mockResolvedValue(null);
    expect((await handleProfileSave(form("visibility=private"), deps)).status).toBe(401);
  });

  it("treats a form in another encoding as a bad request, not an outage", async () => {
    const other = new Request("http://localhost/api/me/profile", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: "not a multipart body",
    });
    const response = await handleProfileSave(other, deps);

    expect(response.headers.get("Location")).toBe("/my/settings?profil=blad#profil");
    expect(save).not.toHaveBeenCalled();
  });
});
