import { describe, expect, it, vi } from "vitest";

import type { AlbumDeps, AlbumRepository } from "@/features/album/application/album-types";
import { getHomeAlbum } from "@/features/album/application/home-album";
import type { Actor } from "@/features/identity/domain/actor";

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };

function makeDeps(over: Partial<AlbumRepository> = {}) {
  const withUserContext = vi.fn(async (_actor: unknown, work: (tx: never) => Promise<unknown>) =>
    work({} as never),
  );
  const repository = {
    homeSummary: vi.fn(async () => ({ discoveredPlaces: 3, regions: 1, savedCollections: 2 })),
    homeFavorites: vi.fn(async () => [
      { id: "a", slug: "a", title: "A", region: "pomorskie" as const, total: 4, visited: 1 },
      { id: "b", slug: "b", title: "B", region: "lodzkie" as const, total: 0, visited: 0 },
    ]),
    homeRecentVisits: vi.fn(async () => []),
    homeIncompleteSaved: vi.fn(async () => [
      { id: "a", slug: "a", title: "A", total: 4, visited: 1 },
    ]),
    homeUnvisitedPlaces: vi.fn(async () => [{ collectionId: "a", name: "Zamek", position: 2 }]),
    homeStartedUnsaved: vi.fn(async () => []),
    homeHasSavedWithPlaces: vi.fn(async () => true),
    ...over,
  } as unknown as AlbumRepository;

  return {
    deps: { withUserContext, repository } as unknown as AlbumDeps,
    withUserContext,
    repository,
  };
}

describe("getHomeAlbum", () => {
  it("answers unauthenticated for a guest without touching the database", async () => {
    const { deps, withUserContext } = makeDeps();

    expect(await getHomeAlbum(null, deps)).toEqual({ status: "unauthenticated" });
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("reads summary, favourites, visits and reasons to return in one user context", async () => {
    const { deps, repository, withUserContext } = makeDeps();
    const result = await getHomeAlbum(actor, deps);

    expect(withUserContext).toHaveBeenCalledTimes(1);
    expect(withUserContext).toHaveBeenCalledWith(actor, expect.any(Function));
    expect(repository.homeFavorites).toHaveBeenCalledTimes(1);
    expect(repository.homeFavorites).toHaveBeenCalledWith(expect.anything(), 6);
    expect(repository.homeRecentVisits).toHaveBeenCalledWith(expect.anything(), 5);
    expect(repository.homeIncompleteSaved).toHaveBeenCalledWith(expect.anything(), 4);
    expect(repository.homeUnvisitedPlaces).toHaveBeenCalledWith(expect.anything(), ["a"], 2);
    expect(result).toEqual({
      status: "ok",
      value: {
        summary: { discoveredPlaces: 3, regions: 1, savedCollections: 2 },
        favorites: [
          {
            id: "a",
            slug: "a",
            title: "A",
            region: "pomorskie",
            progress: { kind: "progress", visited: 1, total: 4 },
          },
          { id: "b", slug: "b", title: "B", region: "lodzkie", progress: { kind: "empty" } },
        ],
        recentVisits: [],
        homeReturn: {
          hasSaved: true,
          remaining: [{ slug: "a", title: "A", remaining: 3, names: ["Zamek"] }],
          saveNudge: null,
        },
      },
    });
  });

  it("skips the places read when nothing is left and passes the nudge on", async () => {
    const nudge = { id: "n", slug: "n", title: "N", visited: 1, total: 3 };
    const { deps, repository } = makeDeps({
      homeIncompleteSaved: vi.fn(async () => []),
      homeStartedUnsaved: vi.fn(async () => [nudge]),
    });
    const result = await getHomeAlbum(actor, deps);

    expect(result).toEqual({
      status: "ok",
      value: expect.objectContaining({
        homeReturn: { hasSaved: true, remaining: [], saveNudge: nudge },
      }),
    });
    expect(repository.homeUnvisitedPlaces).not.toHaveBeenCalled();
  });

  it("has nothing saved for a new explorer", async () => {
    const { deps } = makeDeps({
      homeSummary: vi.fn(async () => ({ discoveredPlaces: 0, regions: 0, savedCollections: 0 })),
      homeFavorites: vi.fn(async () => []),
      homeIncompleteSaved: vi.fn(async () => []),
    });

    expect(await getHomeAlbum(actor, deps)).toEqual({
      status: "ok",
      value: expect.objectContaining({
        homeReturn: { hasSaved: false, remaining: [], saveNudge: null },
      }),
    });
  });

  it("counts a saved collection without places neither as complete nor as open (N4)", async () => {
    const { deps, repository } = makeDeps({
      homeSummary: vi.fn(async () => ({ discoveredPlaces: 0, regions: 0, savedCollections: 1 })),
      homeIncompleteSaved: vi.fn(async () => []),
      homeHasSavedWithPlaces: vi.fn(async () => false),
    });

    expect(await getHomeAlbum(actor, deps)).toEqual({
      status: "ok",
      value: expect.objectContaining({
        homeReturn: { hasSaved: false, remaining: [], saveNudge: null },
      }),
    });
    expect(repository.homeHasSavedWithPlaces).toHaveBeenCalledTimes(1);
  });

  it("does not ask for saved collections with places when nothing is saved", async () => {
    const { deps, repository } = makeDeps({
      homeSummary: vi.fn(async () => ({ discoveredPlaces: 0, regions: 0, savedCollections: 0 })),
      homeIncompleteSaved: vi.fn(async () => []),
    });

    await getHomeAlbum(actor, deps);

    expect(repository.homeHasSavedWithPlaces).not.toHaveBeenCalled();
  });

  it("does not hide an unexpected failure as a refusal", async () => {
    const { deps } = makeDeps({
      homeSummary: vi.fn(async () => {
        throw new Error("db down");
      }),
    });

    await expect(getHomeAlbum(actor, deps)).rejects.toThrow("db down");
  });
});
