import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/features/identity/domain/actor";
import {
  addToWantToSee,
  isWantedPlace,
  listWantToSee,
  removeFromWantToSee,
} from "@/features/want-to-see/application/want-to-see";
import type {
  WantToSeeDeps,
  WantToSeeRepository,
} from "@/features/want-to-see/application/want-to-see-types";

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };
const PLACE = "44444444-4444-4444-8444-444444444441";

function makeDeps(over: Partial<WantToSeeRepository> = {}, allowed = true) {
  const withUserContext = vi.fn(async (_actor: unknown, work: (tx: never) => Promise<unknown>) =>
    work({} as never),
  );
  const reserve = vi.fn(async () =>
    allowed ? { allowed: true as const } : { allowed: false as const, retryAfterSeconds: 9 },
  );
  const repository: WantToSeeRepository = {
    listPlaces: async () => [],
    isPubliclyVisiblePlace: async () => true,
    addPlace: vi.fn(async () => "added" as const),
    removePlace: vi.fn(async () => undefined),
    isPlaceWanted: async () => false,
    ...over,
  };

  return {
    deps: { withUserContext, limiter: { reserve }, repository } as unknown as WantToSeeDeps,
    withUserContext,
    reserve,
    repository,
  };
}

describe("addToWantToSee", () => {
  it("adds a visible place for the actor of the session", async () => {
    const { deps, repository, withUserContext } = makeDeps();

    expect(await addToWantToSee(actor, PLACE, deps)).toEqual({
      status: "ok",
      value: { wanted: true },
    });
    expect(repository.addPlace).toHaveBeenCalledWith(expect.anything(), PLACE);
    expect(withUserContext).toHaveBeenCalledWith(actor, expect.any(Function));
  });

  it("answers unauthenticated for a guest before the limiter or the database", async () => {
    const { deps, reserve, withUserContext } = makeDeps();

    expect(await addToWantToSee(null, PLACE, deps)).toEqual({ status: "unauthenticated" });
    expect(reserve).not.toHaveBeenCalled();
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("answers rate_limited without opening the database", async () => {
    const { deps, withUserContext } = makeDeps({}, false);

    expect(await addToWantToSee(actor, PLACE, deps)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 9,
    });
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("answers not_found for a malformed id and for a place that is not public", async () => {
    const hidden = makeDeps({ isPubliclyVisiblePlace: async () => false });

    expect(await addToWantToSee(actor, "not-a-uuid", makeDeps().deps)).toEqual({
      status: "not_found",
    });
    expect(await addToWantToSee(actor, PLACE, hidden.deps)).toEqual({ status: "not_found" });
    expect(hidden.repository.addPlace).not.toHaveBeenCalled();
  });

  it("answers not_found when the place stops being public between the check and the add", async () => {
    const { deps } = makeDeps({ addPlace: vi.fn(async () => "not_found" as const) });

    expect(await addToWantToSee(actor, PLACE, deps)).toEqual({ status: "not_found" });
  });

  it("answers conflict when the list already has the largest number of places (D-28)", async () => {
    const { deps } = makeDeps({ addPlace: vi.fn(async () => "too_many" as const) });

    expect(await addToWantToSee(actor, PLACE, deps)).toEqual({
      status: "conflict",
      reason: "too_many_wanted",
    });
  });

  it("does not hide a database failure", async () => {
    const { deps } = makeDeps({
      isPubliclyVisiblePlace: async () => {
        throw new Error("down");
      },
    });

    await expect(addToWantToSee(actor, PLACE, deps)).rejects.toThrow("down");
  });
});

describe("removeFromWantToSee", () => {
  it("removes the own entry and always answers the same", async () => {
    const { deps, repository } = makeDeps();

    expect(await removeFromWantToSee(actor, PLACE, deps)).toEqual({
      status: "ok",
      value: { wanted: false },
    });
    expect(repository.removePlace).toHaveBeenCalledWith(expect.anything(), PLACE);
  });

  it("refuses a guest, a limit overrun and a malformed id", async () => {
    expect(await removeFromWantToSee(null, PLACE, makeDeps().deps)).toEqual({
      status: "unauthenticated",
    });
    expect(await removeFromWantToSee(actor, PLACE, makeDeps({}, false).deps)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 9,
    });
    expect(await removeFromWantToSee(actor, "x", makeDeps().deps)).toEqual({
      status: "not_found",
    });
  });
});

describe("listWantToSee", () => {
  it("returns the places of the repository without counting against the limit", async () => {
    const places = [
      { id: PLACE, name: "Most", address: "Tczew", savedAt: new Date(0), visited: true },
    ];
    const { deps, reserve } = makeDeps({ listPlaces: async () => places });

    expect(await listWantToSee(actor, deps)).toEqual({ status: "ok", value: places });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("refuses a guest", async () => {
    const { deps, withUserContext } = makeDeps();

    expect(await listWantToSee(null, deps)).toEqual({ status: "unauthenticated" });
    expect(withUserContext).not.toHaveBeenCalled();
  });
});

describe("isWantedPlace", () => {
  it("says whether the place is on the list of the actor", async () => {
    expect(
      await isWantedPlace(actor, PLACE, makeDeps({ isPlaceWanted: async () => true }).deps),
    ).toEqual({ status: "ok", value: { wanted: true } });
    expect(await isWantedPlace(actor, PLACE, makeDeps().deps)).toEqual({
      status: "ok",
      value: { wanted: false },
    });
  });

  it("refuses a guest and a malformed id", async () => {
    expect(await isWantedPlace(null, PLACE, makeDeps().deps)).toEqual({
      status: "unauthenticated",
    });
    expect(await isWantedPlace(actor, "x", makeDeps().deps)).toEqual({ status: "not_found" });
  });
});
