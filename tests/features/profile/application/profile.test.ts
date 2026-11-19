import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/features/identity/domain/actor";
import { getMyProfile, saveMyProfile } from "@/features/profile/application/profile";
import type { ProfileDeps, ProfileRepository } from "@/features/profile/application/profile-types";
import { DEFAULT_PROFILE, type Profile } from "@/features/profile/domain/profile";

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };
const body = { firstName: "Anna", familyInitial: "K", region: "pomorskie", visibility: "public" };
const stored: Profile = {
  firstName: "Anna",
  familyInitial: "K",
  region: "pomorskie",
  visibility: "public",
};

function makeDeps(over: Partial<ProfileRepository> = {}, allowed = true) {
  const withUserContext = vi.fn(async (_actor: unknown, work: (tx: never) => Promise<unknown>) =>
    work({} as never),
  );
  const reserve = vi.fn(async () =>
    allowed ? { allowed: true as const } : { allowed: false as const, retryAfterSeconds: 9 },
  );
  const repository: ProfileRepository = {
    read: vi.fn(async () => stored),
    save: vi.fn(async (_tx, profile: Profile) => profile),
    ...over,
  };

  return {
    deps: { withUserContext, limiter: { reserve }, repository } as unknown as ProfileDeps,
    withUserContext,
    reserve,
    repository,
  };
}

describe("getMyProfile", () => {
  it("reads the profile of the actor of the session", async () => {
    const { deps, withUserContext } = makeDeps();

    expect(await getMyProfile(actor, deps)).toEqual({ status: "ok", value: stored });
    expect(withUserContext).toHaveBeenCalledWith(actor, expect.any(Function));
  });

  it("gives the defaults when no profile was saved (D-E9-2)", async () => {
    const { deps } = makeDeps({ read: async () => null });

    expect(await getMyProfile(actor, deps)).toEqual({ status: "ok", value: DEFAULT_PROFILE });
  });

  it("answers unauthenticated for a guest before the database", async () => {
    const { deps, withUserContext } = makeDeps();

    expect(await getMyProfile(null, deps)).toEqual({ status: "unauthenticated" });
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("does not hide an unexpected failure", async () => {
    const { deps } = makeDeps({
      read: async () => {
        throw new Error("down");
      },
    });

    await expect(getMyProfile(actor, deps)).rejects.toThrow("down");
  });
});

describe("saveMyProfile", () => {
  it("saves the validated profile for the actor of the session", async () => {
    const { deps, repository, withUserContext, reserve } = makeDeps();

    expect(await saveMyProfile(actor, body, deps)).toEqual({ status: "ok", value: stored });
    expect(repository.save).toHaveBeenCalledWith(expect.anything(), stored);
    expect(withUserContext).toHaveBeenCalledWith(actor, expect.any(Function));
    expect(reserve).toHaveBeenCalledWith("profile_write", actor.id, expect.anything());
  });

  it("answers unauthenticated for a guest before the limiter, the body or the database", async () => {
    const { deps, reserve, withUserContext } = makeDeps();

    expect(await saveMyProfile(null, body, deps)).toEqual({ status: "unauthenticated" });
    expect(await saveMyProfile(null, "garbage", deps)).toEqual({ status: "unauthenticated" });
    expect(reserve).not.toHaveBeenCalled();
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("answers invalid with the fields, without writing", async () => {
    const { deps, repository, withUserContext } = makeDeps();

    expect(await saveMyProfile(actor, { ...body, region: "x" }, deps)).toEqual({
      status: "invalid",
      fields: ["region"],
    });
    expect(await saveMyProfile(actor, { ...body, userId: actor.id }, deps)).toEqual({
      status: "invalid",
      fields: [],
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("answers rate_limited without writing", async () => {
    const { deps, repository } = makeDeps({}, false);

    expect(await saveMyProfile(actor, body, deps)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 9,
    });
    expect(repository.save).not.toHaveBeenCalled();
  });
});
