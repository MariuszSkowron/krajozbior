import { describe, expect, it, vi } from "vitest";

import type { AlbumDeps, AlbumRepository } from "@/features/album/application/album-types";
import {
  getCollectionProgress,
  listMyCollectionsWithProgress,
  saveCollection,
  unsaveCollection,
} from "@/features/album/application/saved-collections";
import type { Actor } from "@/features/identity/domain/actor";

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };
const COLLECTION = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const P1 = "44444444-4444-4444-8444-444444444441";
const P2 = "44444444-4444-4444-8444-444444444442";

function makeDeps(over: Partial<AlbumRepository> = {}, allowed = true) {
  const withUserContext = vi.fn(async (_actor: unknown, work: (tx: never) => Promise<unknown>) =>
    work({} as never),
  );
  const reserve = vi.fn(async () =>
    allowed ? { allowed: true as const } : { allowed: false as const, retryAfterSeconds: 9 },
  );
  const repository: AlbumRepository = {
    listSavedCollections: async () => [],
    listSavedCollectionPlaces: async () => [],
    listVisitedPlaceIds: async () => [],
    isPubliclyVisibleCollection: async () => true,
    saveCollection: vi.fn(async () => undefined),
    unsaveCollection: vi.fn(async () => undefined),
    isCollectionSaved: async () => false,
    listPlaceIdsOfCollection: async () => [],
    listVisitedPlaceIdsOfCollection: async () => [],
    ...over,
  };

  return {
    deps: { withUserContext, limiter: { reserve }, repository } as unknown as AlbumDeps,
    withUserContext,
    reserve,
    repository,
  };
}

describe("saveCollection", () => {
  it("saves a visible collection for the actor of the session", async () => {
    const { deps, repository, withUserContext } = makeDeps();

    expect(await saveCollection(actor, COLLECTION, deps)).toEqual({
      status: "ok",
      value: { saved: true },
    });
    expect(repository.saveCollection).toHaveBeenCalledWith(expect.anything(), COLLECTION);
    expect(withUserContext).toHaveBeenCalledWith(actor, expect.any(Function));
  });

  it("answers unauthenticated for a guest before touching the limiter or the database", async () => {
    const { deps, reserve, withUserContext } = makeDeps();

    expect(await saveCollection(null, COLLECTION, deps)).toEqual({ status: "unauthenticated" });
    expect(reserve).not.toHaveBeenCalled();
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("answers rate_limited without opening the database", async () => {
    const { deps, withUserContext } = makeDeps({}, false);

    expect(await saveCollection(actor, COLLECTION, deps)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 9,
    });
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("answers not_found for a malformed id and for a collection that is not public", async () => {
    const hidden = makeDeps({ isPubliclyVisibleCollection: async () => false });

    expect(await saveCollection(actor, "not-a-uuid", makeDeps().deps)).toEqual({
      status: "not_found",
    });
    expect(await saveCollection(actor, OTHER, hidden.deps)).toEqual({ status: "not_found" });
    expect(hidden.repository.saveCollection).not.toHaveBeenCalled();
  });
});

describe("unsaveCollection", () => {
  it("removes the own save and answers the same when there was none", async () => {
    const { deps, repository } = makeDeps();

    expect(await unsaveCollection(actor, COLLECTION, deps)).toEqual({
      status: "ok",
      value: { saved: false },
    });
    expect(repository.unsaveCollection).toHaveBeenCalledWith(expect.anything(), COLLECTION);
  });

  it("refuses a guest, a malformed id and a limit overrun", async () => {
    expect(await unsaveCollection(null, COLLECTION, makeDeps().deps)).toEqual({
      status: "unauthenticated",
    });
    expect(await unsaveCollection(actor, "x", makeDeps().deps)).toEqual({ status: "not_found" });
    expect(await unsaveCollection(actor, COLLECTION, makeDeps({}, false).deps)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 9,
    });
  });
});

describe("listMyCollectionsWithProgress", () => {
  it("counts X/Y per collection with the domain rule; one visit counts in every collection", async () => {
    const { deps } = makeDeps({
      listSavedCollections: async () => [
        { id: COLLECTION, slug: "a", title: "A", region: "pomorskie" },
        { id: OTHER, slug: "b", title: "B", region: "pomorskie" },
        { id: "55555555-5555-4555-8555-555555555555", slug: "c", title: "C", region: "pomorskie" },
      ],
      listSavedCollectionPlaces: async () => [
        { collectionId: COLLECTION, placeId: P1 },
        { collectionId: COLLECTION, placeId: P2 },
        { collectionId: OTHER, placeId: P1 },
      ],
      listVisitedPlaceIds: async () => [P1],
    });
    const result = await listMyCollectionsWithProgress(actor, deps);

    expect(result.status).toBe("ok");
    expect(result.status === "ok" ? result.value.map(({ progress }) => progress) : null).toEqual([
      { kind: "progress", visited: 1, total: 2 },
      { kind: "progress", visited: 1, total: 1 },
      { kind: "empty" },
    ]);
  });

  it("answers an empty list for an explorer with no saves, and unauthenticated for a guest", async () => {
    expect(await listMyCollectionsWithProgress(actor, makeDeps().deps)).toEqual({
      status: "ok",
      value: [],
    });
    expect(await listMyCollectionsWithProgress(null, makeDeps().deps)).toEqual({
      status: "unauthenticated",
    });
  });
});

describe("getCollectionProgress", () => {
  it("returns the saved state and the progress of the actor", async () => {
    const { deps } = makeDeps({
      isCollectionSaved: async () => true,
      listPlaceIdsOfCollection: async () => [P1, P2],
      listVisitedPlaceIdsOfCollection: async () => [P2],
    });

    expect(await getCollectionProgress(actor, COLLECTION, deps)).toEqual({
      status: "ok",
      value: { saved: true, progress: { kind: "progress", visited: 1, total: 2 } },
    });
  });

  it("refuses a guest and a malformed id", async () => {
    expect(await getCollectionProgress(null, COLLECTION, makeDeps().deps)).toEqual({
      status: "unauthenticated",
    });
    expect(await getCollectionProgress(actor, "x", makeDeps().deps)).toEqual({
      status: "not_found",
    });
  });
});
