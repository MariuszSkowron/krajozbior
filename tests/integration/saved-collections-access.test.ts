import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AlbumDeps } from "@/features/album/application/album-types";
import {
  getCollectionProgress,
  listMyCollectionsWithProgress,
  saveCollection,
  unsaveCollection,
} from "@/features/album/application/saved-collections";
import { postgresAlbumRepository } from "@/features/album/infrastructure/postgres-album-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// E2, PR6: saving a collection and "Moje kolekcje" through the real use cases
// and the real routes on a real database (docs/data-isolation.md, class PRIV).
// The session and the database come from the test; everything else is the
// shipped code. `app` is a pooled connection as krajozbior_app.
const state = vi.hoisted(() => ({
  session: null as { id: string; role: "user" | "admin" } | null,
  allow: true,
  app: null as unknown as import("@mikro-orm/postgresql").MikroORM,
}));

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: async () => state.session }),
  getActionRateLimiter: () => ({
    reserve: async () =>
      state.allow ? { allowed: true } : { allowed: false, retryAfterSeconds: 7 },
  }),
}));
vi.mock("@/features/album/infrastructure/album-deps", () => ({
  getAlbumDeps: () => ({
    withUserContext: (actor: { id: string }, work: never) =>
      runInUserContext(state.app.em, actor, work),
    limiter: {
      reserve: async () =>
        state.allow ? { allowed: true } : { allowed: false, retryAfterSeconds: 7 },
    },
    repository: postgresAlbumRepository,
  }),
}));

let db: ScratchDatabase;
let app: MikroORM;

const explorerA = newUser("sc-explorer-a");
const explorerB = newUser("sc-explorer-b");
const admin = newUser("sc-admin");
const cur = newUser("sc-cur");

const f = albumFixtures({ db: () => db, app: () => app });
const deps = (): AlbumDeps => ({
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresAlbumRepository,
});
const a = { ...explorerA, role: "user" as const };
const b = { ...explorerB, role: "user" as const };
const curActor = { ...cur, role: "user" as const };

const savedRows = (userId: string) =>
  f.admin$<{ collection_id: string }>(
    `select collection_id from public.saved_collections where user_id = $1`,
    [userId],
  );

let orgId = "";
// Loaded after the mocks are in place.
let route: typeof import("@/app/api/me/saved-collections/[collectionId]/route");

const request = (method: string, collectionId: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/me/saved-collections/${collectionId}`, { method, headers });
const ctx = (collectionId: string) => ({ params: Promise.resolve({ collectionId }) });

describe("saved collections: use cases and routes", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_saved_collections");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, admin, cur]);
    orgId = await f.newOrganization("Gmina Zapisów", "gmina-zapisow", [cur]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
    state.app = app;
    route = await import("@/app/api/me/saved-collections/[collectionId]/route");
  }, 60_000);

  beforeEach(() => {
    state.session = null;
    state.allow = true;
  });

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("saves a published collection and lists it with 0/N; the save is idempotent", async () => {
    const { collectionId } = await f.publishedCollection(cur, orgId, 2);

    expect(await saveCollection(a, collectionId, deps())).toEqual({
      status: "ok",
      value: { saved: true },
    });
    expect(await saveCollection(a, collectionId, deps())).toEqual({
      status: "ok",
      value: { saved: true },
    });
    expect(await savedRows(a.id)).toEqual([{ collection_id: collectionId }]);

    const list = await listMyCollectionsWithProgress(a, deps());

    expect(list.status === "ok" ? list.value.map((c) => c.progress) : null).toEqual([
      { kind: "progress", visited: 0, total: 2 },
    ]);
  });

  it("counts a visited place and counts it in every saved collection that holds it", async () => {
    const first = await f.publishedCollection(cur, orgId, 2);
    const second = await f.newCollection(cur, orgId);

    await f.link(cur, second, first.placeIds[0]!, orgId, 1);
    await f.setStatus(cur, second, "published");
    await saveCollection(b, first.collectionId, deps());
    await saveCollection(b, second, deps());
    await f.as(
      b,
      `insert into public.visits (user_id, place_id, kind, date_precision)
       values (app_current_user_id(), ?, 'past', 'unknown')`,
      [first.placeIds[0]],
    );

    const view = await getCollectionProgress(b, first.collectionId, deps());
    const list = await listMyCollectionsWithProgress(b, deps());
    const byId = new Map(list.status === "ok" ? list.value.map((c) => [c.id, c.progress]) : []);

    expect(view).toEqual({
      status: "ok",
      value: { saved: true, progress: { kind: "progress", visited: 1, total: 2 } },
    });
    expect(byId.get(first.collectionId)).toEqual({ kind: "progress", visited: 1, total: 2 });
    expect(byId.get(second)).toEqual({ kind: "progress", visited: 1, total: 1 });
  });

  it("denies explorer B any view of, or change to, the saves of explorer A", async () => {
    const { collectionId } = await f.publishedCollection(cur, orgId);
    const slug = (
      await f.admin$<{ slug: string }>(`select slug from public.collections where id = $1`, [
        collectionId,
      ])
    )[0]!.slug;

    await saveCollection(a, collectionId, deps());

    const listB = await listMyCollectionsWithProgress(b, deps());
    const viewB = await getCollectionProgress(b, collectionId, deps());

    expect(listB.status === "ok" ? listB.value.map((c) => c.slug) : null).not.toContain(slug);
    expect(viewB).toMatchObject({ status: "ok", value: { saved: false } });

    // B's delete matches no row of A: the answer is the same, the row stays.
    expect(await unsaveCollection(b, collectionId, deps())).toEqual({
      status: "ok",
      value: { saved: false },
    });
    expect(await savedRows(a.id)).toContainEqual({ collection_id: collectionId });

    // The same through raw SQL as B: nothing to read, nothing to delete.
    expect(
      await f.as(b, `select * from public.saved_collections where collection_id = ?`, [
        collectionId,
      ]),
    ).toEqual([]);
    expect(
      await f.as(
        b,
        `delete from public.saved_collections where collection_id = ? returning collection_id`,
        [collectionId],
      ),
    ).toEqual([]);
    expect(await savedRows(a.id)).toContainEqual({ collection_id: collectionId });

    // And A can remove their own.
    await unsaveCollection(a, collectionId, deps());
    expect(await savedRows(a.id)).not.toContainEqual({ collection_id: collectionId });
  });

  it("refuses a guest with unauthenticated and a missing, malformed or non-public collection with not_found", async () => {
    const draft = await f.draftCollection(cur, orgId);
    const withdrawn = await f.publishedCollection(cur, orgId);

    await f.setStatus(cur, withdrawn.collectionId, "draft");

    expect(await saveCollection(null, withdrawn.collectionId, deps())).toEqual({
      status: "unauthenticated",
    });
    expect(await unsaveCollection(null, withdrawn.collectionId, deps())).toEqual({
      status: "unauthenticated",
    });
    expect(await listMyCollectionsWithProgress(null, deps())).toEqual({
      status: "unauthenticated",
    });
    expect(await getCollectionProgress(null, withdrawn.collectionId, deps())).toEqual({
      status: "unauthenticated",
    });
    for (const id of [
      draft.collectionId,
      withdrawn.collectionId,
      "not-a-uuid",
      crypto.randomUUID(),
    ]) {
      expect(await saveCollection(a, id, deps())).toEqual({ status: "not_found" });
    }
    // The curator-member cannot save the own draft either (W2): the database sees a draft, the use case says not_found.
    expect(await saveCollection(curActor, draft.collectionId, deps())).toEqual({
      status: "not_found",
    });
  });

  it("hides a withdrawn collection from the list and brings it back with the same progress", async () => {
    const { collectionId } = await f.publishedCollection(cur, orgId);

    await saveCollection(a, collectionId, deps());
    await f.setStatus(cur, collectionId, "draft");

    const hidden = await listMyCollectionsWithProgress(a, deps());

    expect(hidden.status === "ok" ? hidden.value.map((c) => c.id) : null).not.toContain(
      collectionId,
    );
    expect(await savedRows(a.id)).toContainEqual({ collection_id: collectionId });

    await f.setStatus(cur, collectionId, "published");

    const back = await listMyCollectionsWithProgress(a, deps());

    expect(back.status === "ok" ? back.value.map((c) => c.id) : null).toContain(collectionId);
  });

  it("does not show a curator their own withdrawn collection as saved", async () => {
    const { collectionId } = await f.publishedCollection(cur, orgId);

    await saveCollection(curActor, collectionId, deps());
    await f.setStatus(cur, collectionId, "draft");

    const list = await listMyCollectionsWithProgress(curActor, deps());

    expect(list.status === "ok" ? list.value.map((c) => c.id) : null).not.toContain(collectionId);
  });

  it("answers rate_limited without writing", async () => {
    const { collectionId } = await f.publishedCollection(cur, orgId);
    const limited: AlbumDeps = {
      ...deps(),
      limiter: { reserve: async () => ({ allowed: false, retryAfterSeconds: 5 }) },
    };

    expect(await saveCollection(b, collectionId, limited)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 5,
    });
    expect(await savedRows(b.id)).not.toContainEqual({ collection_id: collectionId });
  });

  describe("routes", () => {
    it("answers 401 to a guest, with no store cache, and writes nothing", async () => {
      const { collectionId } = await f.publishedCollection(cur, orgId);
      const put = await route.PUT(request("PUT", collectionId), ctx(collectionId));
      const del = await route.DELETE(request("DELETE", collectionId), ctx(collectionId));

      expect([put.status, del.status]).toEqual([401, 401]);
      expect(put.headers.get("cache-control")).toBe("private, no-store");
    });

    it("saves with PUT and removes with DELETE, answering 200 each time (idempotent)", async () => {
      const { collectionId } = await f.publishedCollection(cur, orgId);

      state.session = { id: explorerA.id, role: "user" };
      for (const method of ["PUT", "PUT"]) {
        const response = await route.PUT(request(method, collectionId), ctx(collectionId));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ saved: true });
      }
      for (let i = 0; i < 2; i += 1) {
        const response = await route.DELETE(request("DELETE", collectionId), ctx(collectionId));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ saved: false });
      }
      expect(await savedRows(explorerA.id)).not.toContainEqual({ collection_id: collectionId });
    });

    it("lets an administrator account save for itself (an administrator is a plain account in the album)", async () => {
      const { collectionId } = await f.publishedCollection(cur, orgId);

      state.session = { id: admin.id, role: "admin" };

      expect((await route.PUT(request("PUT", collectionId), ctx(collectionId))).status).toBe(200);
      expect(await savedRows(admin.id)).toEqual([{ collection_id: collectionId }]);
    });

    it("answers 404 for a draft, a malformed id and an unknown id, 403 for another origin, 429 over the limit", async () => {
      const draft = await f.draftCollection(cur, orgId);
      const { collectionId } = await f.publishedCollection(cur, orgId);

      state.session = { id: explorerB.id, role: "user" };
      for (const id of [draft.collectionId, "not-a-uuid", crypto.randomUUID()]) {
        expect((await route.PUT(request("PUT", id), ctx(id))).status).toBe(404);
      }

      const foreign = await route.PUT(
        request("PUT", collectionId, { origin: "https://evil.example" }),
        ctx(collectionId),
      );

      expect(foreign.status).toBe(403);
      expect(await savedRows(explorerB.id)).not.toContainEqual({ collection_id: collectionId });

      state.allow = false;

      const limited = await route.PUT(request("PUT", collectionId), ctx(collectionId));

      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("7");
    });

    it("never lets explorer B remove the save of explorer A through DELETE", async () => {
      const { collectionId } = await f.publishedCollection(cur, orgId);

      state.session = { id: explorerA.id, role: "user" };
      await route.PUT(request("PUT", collectionId), ctx(collectionId));

      state.session = { id: explorerB.id, role: "user" };
      expect((await route.DELETE(request("DELETE", collectionId), ctx(collectionId))).status).toBe(
        200,
      );
      expect(await savedRows(explorerA.id)).toContainEqual({ collection_id: collectionId });
    });
  });
});
