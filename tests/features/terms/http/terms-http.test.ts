import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TermsDeps } from "@/features/terms/application/terms-types";
import { CURRENT_TERMS_VERSION } from "@/features/terms/domain/terms-version";

const provider = vi.hoisted(() => ({ getActor: vi.fn() }));

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => provider,
}));
vi.mock("@/features/terms/infrastructure/terms-deps", () => ({
  getTermsDeps: () => {
    throw new Error("the real dependencies must not be built in a unit test");
  },
}));

const { handleTermsAcceptance } = await import("@/features/terms/http/terms-http");

const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" } as const;
const accept = vi.fn(async () => undefined);
const deps = {
  withUserContext: async (_a: unknown, work: (tx: never) => Promise<unknown>) => work({} as never),
  repository: { hasAccepted: async () => false, accept },
} as unknown as TermsDeps;

function post(body: string, contentType: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/me/terms-acceptance", {
    method: "POST",
    headers: { "content-type": contentType, ...headers },
    body,
  });
}

const form = (body: string, headers?: Record<string, string>) =>
  post(body, "application/x-www-form-urlencoded", headers);
const json = (body: unknown) => post(JSON.stringify(body), "application/json");

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  accept.mockReset().mockResolvedValue(undefined);
  provider.getActor.mockReset().mockResolvedValue(actor);
});

describe("POST /api/me/terms-acceptance", () => {
  it("records the current version and sends a form back to the page it came from", async () => {
    const response = await handleTermsAcceptance(
      form("accepted=on&returnTo=%2Fmy%2Fcollections"),
      deps,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/my/collections");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(accept).toHaveBeenCalledWith(expect.anything(), CURRENT_TERMS_VERSION);
  });

  it("falls back to the home page for a missing or foreign return address", async () => {
    expect((await handleTermsAcceptance(form("accepted=on"), deps)).headers.get("Location")).toBe(
      "/",
    );
    expect(
      (
        await handleTermsAcceptance(form("accepted=on&returnTo=https%3A%2F%2Fevil.example"), deps)
      ).headers.get("Location"),
    ).toBe("/");
  });

  it("answers JSON with 200 and records the version", async () => {
    const response = await handleTermsAcceptance(json({ accepted: true }), deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it("takes neither an owner nor a version from the body", async () => {
    await handleTermsAcceptance(json({ accepted: true, userId: "x", version: "9.9" }), deps);

    expect(accept).toHaveBeenCalledExactlyOnceWith(expect.anything(), CURRENT_TERMS_VERSION);
  });

  it("refuses a form without the checked box and writes nothing", async () => {
    const response = await handleTermsAcceptance(form("returnTo=%2Fmy"), deps);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?zgoda=wymagana");
    expect(accept).not.toHaveBeenCalled();
  });

  it.each([{}, { accepted: false }, [], "text", null])(
    "answers 400 to the JSON body %j",
    async (body) => {
      const response = await handleTermsAcceptance(json(body), deps);

      expect(response.status).toBe(400);
      expect(accept).not.toHaveBeenCalled();
    },
  );

  it("answers 400 to a JSON body that is not JSON", async () => {
    const response = await handleTermsAcceptance(post("{", "application/json"), deps);

    expect(response.status).toBe(400);
  });

  it("turns a guest away before the body is read: 401 for JSON, the login for a form", async () => {
    provider.getActor.mockResolvedValue(null);

    expect((await handleTermsAcceptance(json({ accepted: true }), deps)).status).toBe(401);

    const redirect = await handleTermsAcceptance(form("accepted=on"), deps);

    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("Location")).toBe("/login");
    expect(accept).not.toHaveBeenCalled();
  });

  it("refuses a request from another origin", async () => {
    const response = await handleTermsAcceptance(
      form("accepted=on", { origin: "https://evil.example" }),
      deps,
    );

    expect(response.status).toBe(403);
    expect(accept).not.toHaveBeenCalled();
  });

  it("refuses a body that is too large", async () => {
    const big = `accepted=on&pad=${"x".repeat(2048)}`;

    const asForm = await handleTermsAcceptance(form(big), deps);

    expect(asForm.status).toBe(303);
    expect(asForm.headers.get("Location")).toBe("/?zgoda=wymagana");

    expect((await handleTermsAcceptance(json({ accepted: true, pad: big }), deps)).status).toBe(
      413,
    );
    expect(accept).not.toHaveBeenCalled();
  });

  it("answers 503 for JSON and an error redirect for a form when the database fails, logging only the class", async () => {
    accept.mockRejectedValue(new Error("db down: secret"));

    expect((await handleTermsAcceptance(json({ accepted: true }), deps)).status).toBe(503);

    const redirect = await handleTermsAcceptance(form("accepted=on"), deps);

    expect(redirect.headers.get("Location")).toBe("/?zgoda=niedostepny");
    expect(console.error).toHaveBeenCalledWith("Terms acceptance failed:", "Error");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });
});
