import { describe, expect, it, vi } from "vitest";

import type { AlbumDeps, AlbumRepository } from "@/features/album/application/album-types";
import { getHomeReturn } from "@/features/album/application/home-album";
import type { Actor } from "@/features/identity/domain/actor";

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };

function makeDeps(over: Partial<AlbumRepository> = {}) {
  const withUserContext = vi.fn(async (_actor: unknown, work: (tx: never) => Promise<unknown>) =>
    work({} as never),
  );
  const repository = {
    homeFavorites: vi.fn(async () => [
      { id: "a", slug: "a", title: "A", region: "pomorskie" as const, total: 3, visited: 1 },
      { id: "b", slug: "b", title: "B", region: "lodzkie" as const, total: 2, visited: 2 },
    ]),
    homeUnvisitedPlaces: vi.fn(async () => [{ collectionId: "a", name: "Zamek", position: 2 }]),
    homeStartedUnsaved: vi.fn(async () => []),
    ...over,
  } as unknown as AlbumRepository;

  return {
    deps: { withUserContext, repository } as unknown as AlbumDeps,
    withUserContext,
    repository,
  };
}

describe("getHomeReturn", () => {
  it("answers unauthenticated for a guest without touching the database", async () => {
    const { deps, withUserContext } = makeDeps();

    expect(await getHomeReturn(null, deps)).toEqual({ status: "unauthenticated" });
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("reads in one user context and asks for places only of incomplete collections", async () => {
    const { deps, repository, withUserContext } = makeDeps();
    const result = await getHomeReturn(actor, deps);

    expect(withUserContext).toHaveBeenCalledTimes(1);
    expect(repository.homeUnvisitedPlaces).toHaveBeenCalledWith(expect.anything(), ["a"], 2);
    expect(result).toEqual({
      status: "ok",
      value: {
        hasSaved: true,
        remaining: [{ slug: "a", title: "A", remaining: 2, names: ["Zamek"] }],
        saveNudge: null,
      },
    });
  });

  it("skips the places read when everything is complete and passes the nudge on", async () => {
    const nudge = { id: "n", slug: "n", title: "N", visited: 1, total: 3 };
    const { deps, repository } = makeDeps({
      homeFavorites: vi.fn(async () => [
        { id: "b", slug: "b", title: "B", region: "lodzkie" as const, total: 2, visited: 2 },
      ]),
      homeStartedUnsaved: vi.fn(async () => [nudge]),
    });

    expect(await getHomeReturn(actor, deps)).toEqual({
      status: "ok",
      value: { hasSaved: true, remaining: [], saveNudge: nudge },
    });
    expect(repository.homeUnvisitedPlaces).not.toHaveBeenCalled();
  });

  it("has nothing saved for a new explorer", async () => {
    const { deps } = makeDeps({ homeFavorites: vi.fn(async () => []) });

    expect(await getHomeReturn(actor, deps)).toEqual({
      status: "ok",
      value: { hasSaved: false, remaining: [], saveNudge: null },
    });
  });
});
