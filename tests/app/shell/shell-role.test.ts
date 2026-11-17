import { notFound } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getRequestActor: vi.fn(), logActorFailure: vi.fn() }));

vi.mock("@/app/request-actor", () => mocks);

const { shellRole } = await import("@/app/shell/shell-role");

const id = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mocks.getRequestActor.mockReset();
  mocks.logActorFailure.mockReset();
});

describe("shellRole", () => {
  it.each(["user", "admin"] as const)("returns the role %s of the actor", async (role) => {
    mocks.getRequestActor.mockResolvedValue({ id, role });

    expect(await shellRole()).toBe(role);
    expect(mocks.logActorFailure).not.toHaveBeenCalled();
  });

  it("returns null for a guest", async () => {
    mocks.getRequestActor.mockResolvedValue(null);

    expect(await shellRole()).toBeNull();
    expect(mocks.logActorFailure).not.toHaveBeenCalled();
  });

  it("returns null and logs when the session lookup fails", async () => {
    const failure = new Error("database down");

    mocks.getRequestActor.mockRejectedValue(failure);

    expect(await shellRole()).toBeNull();
    expect(mocks.logActorFailure).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it("lets a Next.js signal through without logging it", async () => {
    let signal: unknown;

    try {
      notFound();
    } catch (error) {
      signal = error;
    }
    mocks.getRequestActor.mockRejectedValue(signal);

    await expect(shellRole()).rejects.toBe(signal);
    expect(mocks.logActorFailure).not.toHaveBeenCalled();
  });
});
