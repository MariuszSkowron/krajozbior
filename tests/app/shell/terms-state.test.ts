import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestActor: vi.fn(),
  hasAccepted: vi.fn(),
  hasAnyAcceptance: vi.fn(),
}));

vi.mock("@/app/request-actor", () => ({ getRequestActor: mocks.getRequestActor }));
vi.mock("@/features/terms/infrastructure/terms-deps", () => ({
  getTermsDeps: () => ({
    withUserContext: async (_actor: unknown, work: (tx: never) => Promise<unknown>) =>
      work({} as never),
    repository: {
      hasAccepted: mocks.hasAccepted,
      hasAnyAcceptance: mocks.hasAnyAcceptance,
      accept: vi.fn(),
    },
  }),
}));

const { shellTermsAccepted, shellTermsEverAccepted } = await import("@/app/shell/terms-state");

const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" } as const;

beforeEach(() => {
  vi.spyOn(console, "error")
    .mockClear()
    .mockImplementation(() => undefined);
  mocks.getRequestActor.mockReset().mockResolvedValue(actor);
  mocks.hasAccepted.mockReset().mockResolvedValue(true);
  mocks.hasAnyAcceptance.mockReset().mockResolvedValue(true);
});

describe("shellTermsEverAccepted", () => {
  it("lets a guest through without asking the database", async () => {
    mocks.getRequestActor.mockResolvedValue(null);

    expect(await shellTermsEverAccepted()).toBe(true);
    expect(mocks.hasAnyAcceptance).not.toHaveBeenCalled();
  });

  it.each([true, false])("answers %s from the database", async (value) => {
    mocks.hasAnyAcceptance.mockResolvedValue(value);

    expect(await shellTermsEverAccepted()).toBe(value);
  });

  it("answers true (the wording that promises nothing) and logs when the lookup fails", async () => {
    mocks.hasAnyAcceptance.mockRejectedValue(new Error("db down: secret"));

    expect(await shellTermsEverAccepted()).toBe(true);
    expect(console.error).toHaveBeenCalledWith("Terms acceptance history lookup failed:", "Error");
  });
});

describe("shellTermsAccepted", () => {
  it("lets a guest through without asking the database", async () => {
    mocks.getRequestActor.mockResolvedValue(null);

    expect(await shellTermsAccepted()).toBe(true);
    expect(mocks.hasAccepted).not.toHaveBeenCalled();
  });

  it.each([true, false])("answers %s for a signed-in account from the database", async (value) => {
    mocks.hasAccepted.mockResolvedValue(value);

    expect(await shellTermsAccepted()).toBe(value);
  });

  it("fails closed and logs only the error class when the lookup fails", async () => {
    mocks.hasAccepted.mockRejectedValue(new Error("db down: secret"));

    expect(await shellTermsAccepted()).toBe(false);
    expect(console.error).toHaveBeenCalledWith("Terms acceptance lookup failed:", "Error");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("passes the Next.js request-time signal on instead of treating it as a failure", async () => {
    const dynamicUsage = Object.assign(new Error("Dynamic server usage"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });

    mocks.getRequestActor.mockRejectedValue(dynamicUsage);

    await expect(shellTermsAccepted()).rejects.toBe(dynamicUsage);
    expect(console.error).not.toHaveBeenCalled();
  });
});
