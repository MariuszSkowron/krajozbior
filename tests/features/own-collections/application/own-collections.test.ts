import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/features/identity/domain/actor";
import {
  addPlaceToOwnCollection,
  createOwnCollection,
  deleteOwnCollection,
  getOwnCollection,
  listOwnCollections,
  removeEntryFromOwnCollection,
  updateOwnCollection,
} from "@/features/own-collections/application/own-collections";
import type {
  OwnCollectionsDeps,
  OwnCollectionsRepository,
  OwnEntryRow,
} from "@/features/own-collections/application/own-collection-types";

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };
const COLLECTION = "22222222-2222-4222-8222-222222222222";
const ENTRY = "33333333-3333-4333-8333-333333333333";
const P1 = "44444444-4444-4444-8444-444444444441";
const P2 = "44444444-4444-4444-8444-444444444442";
const valid = { title: "Wieże", summary: "", region: "polska" };

function makeDeps(over: Partial<OwnCollectionsRepository> = {}, allowed = true) {
  const withUserContext = vi.fn(async (_actor: unknown, work: (tx: never) => Promise<unknown>) =>
    work({} as never),
  );
  const reserve = vi.fn(async () =>
    allowed ? { allowed: true as const } : { allowed: false as const, retryAfterSeconds: 7 },
  );
  const repository: OwnCollectionsRepository = {
    listOwn: async () => [],
    findOwn: async () => ({
      id: COLLECTION,
      title: "Wieże",
      summary: "",
      region: "polska",
      version: 1,
    }),
    listEntries: async () => [],
    create: vi.fn(async () => ({ status: "created" as const, id: COLLECTION })),
    update: vi.fn(async () => "updated" as const),
    remove: vi.fn(async () => true),
    addPlace: vi.fn(async () => "added" as const),
    removeEntry: vi.fn(async () => true),
    ...over,
  };

  return {
    deps: { withUserContext, limiter: { reserve }, repository } as unknown as OwnCollectionsDeps,
    withUserContext,
    reserve,
    repository,
  };
}

const entry = (over: Partial<OwnEntryRow>): OwnEntryRow => ({
  id: ENTRY,
  position: 1,
  placeId: P1,
  nameSnapshot: "Wieża",
  place: { name: "Wieża", address: "Gdańsk" },
  visited: false,
  ...over,
});

describe("every use case", () => {
  it("answers unauthenticated for a guest before touching the limiter or the database", async () => {
    const { deps, reserve, withUserContext } = makeDeps();

    for (const outcome of [
      await listOwnCollections(null, deps),
      await getOwnCollection(null, COLLECTION, deps),
      await createOwnCollection(null, valid, deps),
      await updateOwnCollection(null, COLLECTION, { ...valid, version: 1 }, deps),
      await deleteOwnCollection(null, COLLECTION, deps),
      await addPlaceToOwnCollection(null, COLLECTION, { placeId: P1 }, deps),
      await removeEntryFromOwnCollection(null, COLLECTION, { itemId: ENTRY }, deps),
    ]) {
      expect(outcome).toEqual({ status: "unauthenticated" });
    }
    expect(reserve).not.toHaveBeenCalled();
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("answers rate_limited to a write without opening the database", async () => {
    const { deps, withUserContext } = makeDeps({}, false);

    for (const outcome of [
      await createOwnCollection(actor, valid, deps),
      await updateOwnCollection(actor, COLLECTION, { ...valid, version: 1 }, deps),
      await deleteOwnCollection(actor, COLLECTION, deps),
      await addPlaceToOwnCollection(actor, COLLECTION, { placeId: P1 }, deps),
      await removeEntryFromOwnCollection(actor, COLLECTION, { itemId: ENTRY }, deps),
    ]) {
      expect(outcome).toEqual({ status: "rate_limited", retryAfterSeconds: 7 });
    }
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("does not count a read in the limit", async () => {
    const { deps, reserve } = makeDeps({}, false);

    expect((await listOwnCollections(actor, deps)).status).toBe("ok");
    expect((await getOwnCollection(actor, COLLECTION, deps)).status).toBe("ok");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("turns a malformed id into not_found", async () => {
    const { deps, withUserContext } = makeDeps();

    for (const outcome of [
      await getOwnCollection(actor, "no", deps),
      await updateOwnCollection(actor, "no", { ...valid, version: 1 }, deps),
      await deleteOwnCollection(actor, "no", deps),
      await addPlaceToOwnCollection(actor, "no", { placeId: P1 }, deps),
      await removeEntryFromOwnCollection(actor, "no", { itemId: ENTRY }, deps),
    ]) {
      expect(outcome).toEqual({ status: "not_found" });
    }
    expect(withUserContext).not.toHaveBeenCalled();
  });
});

describe("listOwnCollections", () => {
  it("returns the repository rows in the context of the actor", async () => {
    const rows = [
      {
        id: COLLECTION,
        title: "A",
        summary: "",
        region: "polska" as const,
        version: 1,
        visited: 1,
        total: 2,
      },
    ];
    const { deps, withUserContext } = makeDeps({ listOwn: async () => rows });

    expect(await listOwnCollections(actor, deps)).toEqual({ status: "ok", value: rows });
    expect(withUserContext).toHaveBeenCalledWith(actor, expect.any(Function));
  });
});

describe("getOwnCollection", () => {
  it("answers not_found for a collection that is not the actor's", async () => {
    const { deps } = makeDeps({ findOwn: async () => null });

    expect(await getOwnCollection(actor, COLLECTION, deps)).toEqual({ status: "not_found" });
  });

  it("states every entry and counts only the places that are public now (D-14)", async () => {
    const { deps } = makeDeps({
      listEntries: async () => [
        entry({ id: "a", placeId: P1, visited: true }),
        entry({ id: "b", placeId: P2, place: null, visited: true }),
        entry({ id: "c", placeId: null, place: null }),
        entry({ id: "d", placeId: "44444444-4444-4444-8444-444444444443" }),
      ],
    });
    const result = await getOwnCollection(actor, COLLECTION, deps);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.entries.map((item) => item.state)).toEqual([
        "available",
        "unavailable",
        "removed",
        "available",
      ]);
      expect(result.value.progress).toEqual({ visited: 1, total: 2 });
    }
  });

  it("reads 0 of 0 for an empty collection", async () => {
    const { deps } = makeDeps();
    const result = await getOwnCollection(actor, COLLECTION, deps);

    expect(result.status === "ok" ? result.value.progress : null).toEqual({
      visited: 0,
      total: 0,
    });
  });
});

describe("createOwnCollection", () => {
  it("creates the collection from the validated text", async () => {
    const { deps, repository } = makeDeps();

    expect(await createOwnCollection(actor, valid, deps)).toEqual({
      status: "ok",
      value: { id: COLLECTION },
    });
    expect(repository.create).toHaveBeenCalledWith(expect.anything(), valid);
  });

  it("refuses an invalid body, also one that is not an object", async () => {
    const { deps, withUserContext } = makeDeps();

    expect(await createOwnCollection(actor, { title: "", region: "x" }, deps)).toEqual({
      status: "invalid",
      errors: ["title", "region"],
    });
    expect(await createOwnCollection(actor, undefined, deps)).toEqual({
      status: "invalid",
      errors: ["title", "region"],
    });
    expect(await createOwnCollection(actor, [valid], deps)).toEqual({
      status: "invalid",
      errors: ["title", "region"],
    });
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("maps both limits to a conflict", async () => {
    for (const status of ["too_many_own_collections", "my_collections_full"] as const) {
      const { deps } = makeDeps({ create: async () => ({ status }) });

      expect(await createOwnCollection(actor, valid, deps)).toEqual({
        status: "conflict",
        reason: status,
      });
    }
  });
});

describe("updateOwnCollection", () => {
  it("saves the text when the version is the current one", async () => {
    const { deps, repository } = makeDeps();

    expect(await updateOwnCollection(actor, COLLECTION, { ...valid, version: 3 }, deps)).toEqual({
      status: "ok",
      value: { updated: true },
    });
    expect(repository.update).toHaveBeenCalledWith(expect.anything(), COLLECTION, 3, valid);
  });

  it("refuses invalid text and a missing or odd version", async () => {
    const { deps } = makeDeps();

    expect(await updateOwnCollection(actor, COLLECTION, { title: "", version: 1 }, deps)).toEqual({
      status: "invalid",
      errors: ["title", "region"],
    });

    for (const version of [undefined, "1", 0, 1.5]) {
      expect(await updateOwnCollection(actor, COLLECTION, { ...valid, version }, deps)).toEqual({
        status: "invalid",
        errors: [],
      });
    }
  });

  it("maps a newer version to a conflict and another person's collection to not_found", async () => {
    expect(
      await updateOwnCollection(
        actor,
        COLLECTION,
        { ...valid, version: 1 },
        makeDeps({ update: async () => "stale_version" }).deps,
      ),
    ).toEqual({ status: "conflict", reason: "stale_version" });
    expect(
      await updateOwnCollection(
        actor,
        COLLECTION,
        { ...valid, version: 1 },
        makeDeps({ update: async () => "not_found" }).deps,
      ),
    ).toEqual({ status: "not_found" });
  });
});

describe("deleteOwnCollection", () => {
  it("deletes the actor's collection and answers not_found for any other", async () => {
    expect(await deleteOwnCollection(actor, COLLECTION, makeDeps().deps)).toEqual({
      status: "ok",
      value: { deleted: true },
    });
    expect(
      await deleteOwnCollection(actor, COLLECTION, makeDeps({ remove: async () => false }).deps),
    ).toEqual({ status: "not_found" });
  });
});

describe("addPlaceToOwnCollection", () => {
  it("adds a place, and says whether it was already there", async () => {
    const { deps, repository } = makeDeps();

    expect(await addPlaceToOwnCollection(actor, COLLECTION, { placeId: P1 }, deps)).toEqual({
      status: "ok",
      value: { added: true },
    });
    expect(repository.addPlace).toHaveBeenCalledWith(expect.anything(), COLLECTION, P1);
    expect(
      await addPlaceToOwnCollection(
        actor,
        COLLECTION,
        { placeId: P1 },
        makeDeps({ addPlace: async () => "already_there" }).deps,
      ),
    ).toEqual({ status: "ok", value: { added: false } });
  });

  it("refuses a body without a place id, also one that is not an object", async () => {
    const { deps } = makeDeps();

    for (const body of [{ placeId: "no" }, {}, undefined, null, ["x"]]) {
      expect(await addPlaceToOwnCollection(actor, COLLECTION, body, deps)).toEqual({
        status: "invalid",
        errors: ["placeId"],
      });
    }
  });

  it("maps a place that is not public to not_found and a full collection to a conflict", async () => {
    expect(
      await addPlaceToOwnCollection(
        actor,
        COLLECTION,
        { placeId: P1 },
        makeDeps({ addPlace: async () => "not_found" }).deps,
      ),
    ).toEqual({ status: "not_found" });
    expect(
      await addPlaceToOwnCollection(
        actor,
        COLLECTION,
        { placeId: P1 },
        makeDeps({ addPlace: async () => "too_many_items" }).deps,
      ),
    ).toEqual({ status: "conflict", reason: "too_many_items" });
  });
});

describe("removeEntryFromOwnCollection", () => {
  it("removes an entry and answers not_found for one that is not there", async () => {
    const { deps, repository } = makeDeps();

    expect(await removeEntryFromOwnCollection(actor, COLLECTION, { itemId: ENTRY }, deps)).toEqual({
      status: "ok",
      value: { removed: true },
    });
    expect(repository.removeEntry).toHaveBeenCalledWith(expect.anything(), COLLECTION, ENTRY);
    expect(
      await removeEntryFromOwnCollection(
        actor,
        COLLECTION,
        { itemId: ENTRY },
        makeDeps({ removeEntry: async () => false }).deps,
      ),
    ).toEqual({ status: "not_found" });
  });

  it("refuses a body without an entry id", async () => {
    expect(
      await removeEntryFromOwnCollection(actor, COLLECTION, { itemId: "no" }, makeDeps().deps),
    ).toEqual({ status: "invalid", errors: ["itemId"] });
  });
});
