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

  it("reads summary, favourites and visits in one user context with the limits 6 and 5", async () => {
    const { deps, repository, withUserContext } = makeDeps();
    const result = await getHomeAlbum(actor, deps);

    expect(withUserContext).toHaveBeenCalledTimes(1);
    expect(withUserContext).toHaveBeenCalledWith(actor, expect.any(Function));
    expect(repository.homeFavorites).toHaveBeenCalledWith(expect.anything(), 6);
    expect(repository.homeRecentVisits).toHaveBeenCalledWith(expect.anything(), 5);
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
      },
    });
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
