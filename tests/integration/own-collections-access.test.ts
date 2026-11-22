import { MikroORM } from "@mikro-orm/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addPlaceToOwnCollection,
  createOwnCollection,
  deleteOwnCollection,
  getOwnCollection,
  listOwnCollections,
  removeEntryFromOwnCollection,
  updateOwnCollection,
} from "@/features/own-collections/application/own-collections";
import type { OwnCollectionsDeps } from "@/features/own-collections/application/own-collection-types";
import { OWN_REGIONS } from "@/features/own-collections/domain/own-collection";
import { postgresOwnCollectionsRepository } from "@/features/own-collections/infrastructure/postgres-own-collections-repository";
import { deleteAccountRows } from "@/features/identity/infrastructure/delete-account-rows";
import { createOrmConfig } from "@/lib/db/config";
import { runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser, rejectedByPolicy } from "../support/album-fixtures";
import {
  closePool,
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// E8-1a: private collections of an explorer on a real database, through the real roles (docs/
// data-isolation.md, class "Prywatna z wyborem"; spec E8, criteria 1, 3, 15, 21, 24, 25). The
// session and the database come from the test; everything else is the shipped code. `app` is a
// pooled connection as krajozbior_app (max 1 connection), so a leaked `app.user_id` would show in
// the next transaction.
const state = vi.hoisted(() => ({
  session: null as { id: string; role: "user" | "admin" } | null,
  app: null as unknown as import("@mikro-orm/postgresql").MikroORM,
}));

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: async () => state.session }),
  getActionRateLimiter: () => ({ reserve: async () => ({ allowed: true }) }),
}));
vi.mock("@/features/own-collections/infrastructure/own-collections-deps", async () => {
  const { runInUserContext: run } = await import("@/lib/db/user-context");
  const { postgresOwnCollectionsRepository: repository } =
    await import("@/features/own-collections/infrastructure/postgres-own-collections-repository");

  return {
    getOwnCollectionsDeps: () => ({
      withUserContext: (actor: { id: string }, work: never) => run(state.app.em, actor, work),
      limiter: { reserve: async () => ({ allowed: true }) },
      repository,
    }),
  };
});

const denied = { code: "42501" };

let db: ScratchDatabase;
let app: MikroORM;
let orgId = "";
let authPool: Pool;

const explorerA = newUser("oc-explorer-a");
const explorerB = newUser("oc-explorer-b");
const admin = newUser("oc-admin");
const cur = newUser("oc-curator");
const leaver = newUser("oc-leaver");

const f = albumFixtures({ db: () => db, app: () => app });
const { admin$, as } = f;
const a = { ...explorerA, role: "user" as const };
const b = { ...explorerB, role: "user" as const };
const adminActor = { ...admin, role: "admin" as const };
const curActor = { ...cur, role: "user" as const };

const deps = (): OwnCollectionsDeps => ({
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresOwnCollectionsRepository,
});

const input = { title: "Wieże ciśnień", summary: "Moje ulubione", region: "pomorskie" };

async function newOwn(actor: typeof a, body: Record<string, unknown> = input): Promise<string> {
  const created = await createOwnCollection(actor, body, deps());

  if (created.status !== "ok") {
    throw new Error(`create failed: ${created.status}`);
  }

  return created.value.id;
}

const addPlace = (actor: typeof a, collectionId: string, placeId: string) =>
  addPlaceToOwnCollection(actor, collectionId, { placeId }, deps());

const itemRows = (collectionId: string) =>
  admin$<{ id: string; place_id: string | null; place_name_snapshot: string | null }>(
    `select id, place_id, place_name_snapshot from public.user_collection_items
      where user_collection_id = $1 order by position`,
    [collectionId],
  );

// Loaded after the mocks are in place.
let collectionsRoute: typeof import("@/app/api/me/own-collections/route");
let oneRoute: typeof import("@/app/api/me/own-collections/[id]/route");
let itemsRoute: typeof import("@/app/api/me/own-collections/[id]/items/route");

const write = (method: string, body?: unknown) =>
  new Request("http://localhost/api/me/own-collections", {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("own collections: access and behaviour", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_own_collections");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, admin, cur, leaver]);
    orgId = await f.newOrganization("Gmina Kolekcji", "gmina-kolekcji", [cur]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
    authPool = new Pool({ connectionString: db.urls.krajozbior_auth, max: 2 });
    state.app = app;
    collectionsRoute = await import("@/app/api/me/own-collections/route");
    oneRoute = await import("@/app/api/me/own-collections/[id]/route");
    itemsRoute = await import("@/app/api/me/own-collections/[id]/items/route");
  }, 60_000);

  beforeEach(() => {
    state.session = null;
  });

  afterAll(async () => {
    await closePool(authPool);
    await app?.close(true);
    await db?.drop();
  });

  describe("the catalog of the database", () => {
    it("has forced row level security, policies and the right owner on both tables", async () => {
      await withClient(db.adminUrl, async (client) => {
        expect(
          await findRowLevelSecurityGaps(client, [
            "public.user_collections",
            "public.user_collection_items",
          ]),
        ).toEqual([]);
        expect(await findApplicationRoleGaps(client)).toEqual([]);
      });
    });

    it("grants krajozbior_app exactly the operations of the use cases, by column", async () => {
      const privileges = (table: string) =>
        admin$<Record<string, boolean>>(
          `select has_table_privilege('krajozbior_app', $1, 'select') as "select",
                  has_table_privilege('krajozbior_app', $1, 'insert') as "insert",
                  has_table_privilege('krajozbior_app', $1, 'update') as "update",
                  has_table_privilege('krajozbior_app', $1, 'delete') as "delete",
                  has_table_privilege('krajozbior_app', $1, 'truncate') as "truncate",
                  has_table_privilege('krajozbior_app', $1, 'references') as "references",
                  has_table_privilege('krajozbior_app', $1, 'trigger') as "trigger"`,
          [table],
        );
      const column = async (table: string, name: string, operation: "insert" | "update") =>
        (
          await admin$<{ ok: boolean }>(
            `select has_column_privilege('krajozbior_app', $1, $2, $3) as ok`,
            [table, name, operation],
          )
        )[0]!.ok;

      // Table-level insert and update are false: only the columns below are granted.
      expect((await privileges("public.user_collections"))[0]).toEqual({
        select: true,
        insert: false,
        update: false,
        delete: true,
        truncate: false,
        references: false,
        trigger: false,
      });
      expect((await privileges("public.user_collection_items"))[0]).toEqual({
        select: true,
        insert: false,
        update: false,
        delete: true,
        truncate: false,
        references: false,
        trigger: false,
      });

      for (const name of ["title", "summary", "region"]) {
        expect(await column("public.user_collections", name, "insert")).toBe(true);
        expect(await column("public.user_collections", name, "update")).toBe(true);
      }
      // B3: no grant on the version, the time and the owner.
      for (const name of ["version", "updated_at", "created_at", "id", "owner_user_id"]) {
        expect(await column("public.user_collections", name, "insert"), name).toBe(false);
        expect(await column("public.user_collections", name, "update"), name).toBe(false);
      }

      for (const name of ["user_collection_id", "position", "place_id"]) {
        expect(await column("public.user_collection_items", name, "insert")).toBe(true);
      }
      // B1: the name is the database's, and nothing of an entry is ever updated.
      for (const name of ["place_name_snapshot", "id", "added_at"]) {
        expect(await column("public.user_collection_items", name, "insert"), name).toBe(false);
      }
      for (const name of ["user_collection_id", "position", "place_id", "place_name_snapshot"]) {
        expect(await column("public.user_collection_items", name, "update"), name).toBe(false);
      }
    });

    it("gives the roles of the sign-in and the operator nothing on the new tables", async () => {
      const rows = await admin$<{ role: string; table: string; any: boolean }>(
        `select r.role, t.name as "table",
                has_table_privilege(r.role, t.name, 'select, insert, update, delete')
                  or has_any_column_privilege(r.role, t.name, 'select, insert, update') as "any"
           from (values ('krajozbior_auth'), ('krajozbior_ops')) r(role),
                (values ('public.user_collections'), ('public.user_collection_items')) t(name)`,
      );

      expect(rows.filter((row) => row.any)).toEqual([]);
    });

    it("keeps the list of regions of the CHECK equal to the one of the domain", async () => {
      for (const region of OWN_REGIONS) {
        await expect(
          admin$(
            `insert into public.user_collections (owner_user_id, title, region)
             values ($1, 'Region', $2) returning id`,
            [explorerA.id, region],
          ),
        ).resolves.toHaveLength(1);
      }
      await expect(
        admin$(
          `insert into public.user_collections (owner_user_id, title, region)
           values ($1, 'Region', 'mars')`,
          [explorerA.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await admin$(`delete from public.user_collections where title = 'Region'`);
    });
  });

  describe("without a context and between explorers (surowy SQL jako krajozbior_app)", () => {
    it("shows nothing and refuses a write when no user is set", async () => {
      await newOwn(a);

      await withClient(db.urls.krajozbior_app, async (client) => {
        expect((await client.query(`select 1 from public.user_collections`)).rowCount).toBe(0);
        expect((await client.query(`select 1 from public.user_collection_items`)).rowCount).toBe(0);
        await expect(
          client.query(
            `insert into public.user_collections (title, region) values ('X', 'polska')`,
          ),
        ).rejects.toMatchObject(denied);
      });
    });

    it("hides the collections and entries of A from B, also from the administrator and a curator", async () => {
      const { placeIds } = await f.publishedCollection(cur, orgId, 1);
      const collectionId = await newOwn(a);

      expect((await addPlace(a, collectionId, placeIds[0]!)).status).toBe("ok");

      for (const stranger of [b, adminActor, curActor]) {
        expect(await as(stranger, `select id from public.user_collections`)).toEqual(
          expect.not.arrayContaining([expect.objectContaining({ id: collectionId })]),
        );
        expect(
          await as(
            stranger,
            `select id from public.user_collection_items where user_collection_id = ?`,
            [collectionId],
          ),
        ).toEqual([]);
        // Not even a change or a removal reaches the row.
        expect(
          await as(
            stranger,
            `update public.user_collections set title = 'Przejęta' where id = ? returning id`,
            [collectionId],
          ),
        ).toEqual([]);
        expect(
          await as(stranger, `delete from public.user_collections where id = ? returning id`, [
            collectionId,
          ]),
        ).toEqual([]);
        expect(
          await as(
            stranger,
            `delete from public.user_collection_items where user_collection_id = ? returning id`,
            [collectionId],
          ),
        ).toEqual([]);
      }

      expect(
        (
          await admin$(`select title from public.user_collections where id = $1`, [collectionId])
        )[0],
      ).toEqual({
        title: input.title,
      });
      expect(await itemRows(collectionId)).toHaveLength(1);
    });

    it("refuses B an insert into the collection of A and a collection of B in the name of A", async () => {
      const { placeIds } = await f.publishedCollection(cur, orgId, 1);
      const collectionId = await newOwn(a);

      await expect(
        as(
          b,
          `insert into public.user_collection_items (user_collection_id, position, place_id)
           values (?, 1, ?)`,
          [collectionId, placeIds[0]],
        ),
      ).rejects.toThrow(rejectedByPolicy);
      // The owner column is not even grantable, so another person's id cannot be named.
      await expect(
        as(
          b,
          `insert into public.user_collections (owner_user_id, title, region)
           values (?, 'Cudza', 'polska')`,
          [explorerA.id],
        ),
      ).rejects.toMatchObject(denied);
    });

    it("refuses the version, the owner and an entry name from the application role", async () => {
      const collectionId = await newOwn(a);

      await expect(
        as(a, `update public.user_collections set version = 1 where id = ?`, [collectionId]),
      ).rejects.toMatchObject(denied);
      await expect(
        as(a, `update public.user_collections set owner_user_id = ? where id = ?`, [
          explorerB.id,
          collectionId,
        ]),
      ).rejects.toMatchObject(denied);
      await expect(
        as(
          a,
          `insert into public.user_collection_items (user_collection_id, position, place_id, place_name_snapshot)
           values (?, 1, null, 'Fałszywa')`,
          [collectionId],
        ),
      ).rejects.toMatchObject(denied);
    });

    it("raises the version by itself with every change of the text, never otherwise", async () => {
      const collectionId = await newOwn(a);

      expect((await getOwnCollection(a, collectionId, deps())).status).toBe("ok");
      expect(
        await updateOwnCollection(
          a,
          collectionId,
          { ...input, title: "Nowa nazwa", version: 1 },
          deps(),
        ),
      ).toEqual({ status: "ok", value: { updated: true } });
      expect(
        (
          await admin$<{ version: number }>(
            `select version from public.user_collections where id = $1`,
            [collectionId],
          )
        )[0]!.version,
      ).toBe(2);
      // A stale version is a conflict, and changes nothing.
      expect(
        await updateOwnCollection(
          a,
          collectionId,
          { ...input, title: "Stara wersja", version: 1 },
          deps(),
        ),
      ).toEqual({ status: "conflict", reason: "stale_version" });
      expect(
        (
          await admin$<{ title: string }>(
            `select title from public.user_collections where id = $1`,
            [collectionId],
          )
        )[0]!.title,
      ).toBe("Nowa nazwa");
    });
  });

  describe("the use cases and the routes", () => {
    it("lists only the own collections", async () => {
      const mine = await newOwn(a, { ...input, title: "Tylko moja" });
      const idsOf = async (actor: typeof a) => {
        const listed = await listOwnCollections(actor, deps());

        return listed.status === "ok" ? listed.value.map((row) => row.id) : [];
      };

      expect(await idsOf(a)).toContain(mine);
      expect(await idsOf(b)).not.toContain(mine);
    });

    it("answers a guest 401 on every route, whatever the id", async () => {
      const bogus = "00000000-0000-4000-8000-000000000000";

      for (const response of [
        await collectionsRoute.GET(write("GET")),
        await collectionsRoute.POST(write("POST", input)),
        await oneRoute.PUT(write("PUT", { ...input, version: 1 }), ctx(bogus)),
        await oneRoute.DELETE(write("DELETE"), ctx("no")),
        await itemsRoute.POST(write("POST", { placeId: bogus }), ctx(bogus)),
        await itemsRoute.DELETE(write("DELETE", { itemId: bogus }), ctx(bogus)),
      ]) {
        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
      }
    });

    it("answers B, the curator and the administrator 404 for the collection of A, like for a missing one", async () => {
      const { placeIds } = await f.publishedCollection(cur, orgId, 1);
      const collectionId = await newOwn(a);

      await addPlace(a, collectionId, placeIds[0]!);

      const [item] = await itemRows(collectionId);

      for (const stranger of [b, adminActor, curActor]) {
        state.session = stranger;

        for (const response of [
          await oneRoute.PUT(write("PUT", { ...input, version: 1 }), ctx(collectionId)),
          await oneRoute.DELETE(write("DELETE"), ctx(collectionId)),
          await itemsRoute.POST(write("POST", { placeId: placeIds[0] }), ctx(collectionId)),
          await itemsRoute.DELETE(write("DELETE", { itemId: item!.id }), ctx(collectionId)),
        ]) {
          expect(response.status).toBe(404);
        }
        expect((await getOwnCollection(stranger, collectionId, deps())).status).toBe("not_found");
      }

      expect(await itemRows(collectionId)).toHaveLength(1);
    });

    it("creates, shows, renames and deletes a collection of the owner through the routes", async () => {
      state.session = a;

      const created = await collectionsRoute.POST(write("POST", input));
      const { id } = (await created.json()) as { id: string };

      expect(created.status).toBe(200);
      expect(
        (await oneRoute.PUT(write("PUT", { ...input, title: "Inna", version: 1 }), ctx(id))).status,
      ).toBe(200);
      expect((await collectionsRoute.GET(write("GET"))).status).toBe(200);
      expect((await oneRoute.DELETE(write("DELETE"), ctx(id))).status).toBe(200);
      expect((await getOwnCollection(a, id, deps())).status).toBe("not_found");
    });

    it("refuses a write from another origin, a bad body and a body that is too large", async () => {
      state.session = a;

      expect(
        (
          await collectionsRoute.POST(
            new Request("http://localhost/api/me/own-collections", {
              method: "POST",
              headers: { origin: "http://evil.example", host: "localhost" },
              body: JSON.stringify(input),
            }),
          )
        ).status,
      ).toBe(403);
      expect((await collectionsRoute.POST(write("POST", { title: "" }))).status).toBe(400);
      expect(
        (await collectionsRoute.POST(write("POST", { ...input, summary: "x".repeat(9000) })))
          .status,
      ).toBe(413);
    });
  });

  describe("places of the catalog in an own collection", () => {
    it("adds a public place with its name from the database and is idempotent", async () => {
      const { placeIds } = await f.publishedCollection(cur, orgId, 2);
      const collectionId = await newOwn(a);

      expect(await addPlace(a, collectionId, placeIds[0]!)).toEqual({
        status: "ok",
        value: { added: true },
      });
      expect(await addPlace(a, collectionId, placeIds[0]!)).toEqual({
        status: "ok",
        value: { added: false },
      });
      expect(await addPlace(a, collectionId, placeIds[1]!)).toEqual({
        status: "ok",
        value: { added: true },
      });

      const rows = await itemRows(collectionId);

      expect(rows.map((row) => row.place_id)).toEqual(placeIds);
      expect(rows.map((row) => row.place_name_snapshot)).toEqual(["Miejsce", "Miejsce"]);
    });

    it("takes the name from the place whatever the insert says (B1 b)", async () => {
      const { placeIds } = await f.publishedCollection(cur, orgId, 1);
      const collectionId = await newOwn(a);

      // The superuser may name the column; the trigger overwrites the value all the same.
      await admin$(
        `insert into public.user_collection_items (user_collection_id, position, place_id, place_name_snapshot)
         values ($1, 1, $2, 'Fałszywa nazwa')`,
        [collectionId, placeIds[0]],
      );

      expect((await itemRows(collectionId))[0]!.place_name_snapshot).toBe("Miejsce");
    });

    it("never adds a place of a draft, of a withdrawn collection or of a suspended organization", async () => {
      const draft = await f.draftCollection(cur, orgId, 1);
      const withdrawn = await f.publishedCollection(cur, orgId, 1);
      const suspendedOrg = await f.newOrganization("Gmina Zawieszona", "gmina-zawieszona", [cur]);
      const suspended = await f.publishedCollection(curActor, suspendedOrg, 1);
      const collectionId = await newOwn(a);

      await f.setStatus(cur, withdrawn.collectionId, "draft");
      await admin$(`update public.organizations set status = 'suspended' where id = $1`, [
        suspendedOrg,
      ]);

      for (const placeId of [draft.placeIds[0]!, withdrawn.placeIds[0]!, suspended.placeIds[0]!]) {
        expect(await addPlace(a, collectionId, placeId)).toEqual({ status: "not_found" });
        // The raw insert is refused by the restrictive policy (a foreign key skips RLS).
        await expect(
          as(
            a,
            `insert into public.user_collection_items (user_collection_id, position, place_id)
             values (?, 1, ?)`,
            [collectionId, placeId],
          ),
        ).rejects.toThrow(rejectedByPolicy);
      }
      // An unknown place answers the same.
      expect(await addPlace(a, collectionId, "00000000-0000-4000-8000-000000000000")).toEqual({
        status: "not_found",
      });
      expect(await itemRows(collectionId)).toEqual([]);
    });

    it("keeps a place that stops being public as an entry that does not count, and counts it again when it returns", async () => {
      const { collectionId: curatorCollection, placeIds } = await f.publishedCollection(
        cur,
        orgId,
        2,
      );
      const collectionId = await newOwn(a);

      for (const placeId of placeIds) {
        await addPlace(a, collectionId, placeId);
      }
      await admin$(
        `insert into public.visits (user_id, place_id, kind, date_precision)
         values ($1, $2, 'past', 'unknown')`,
        [explorerA.id, placeIds[0]],
      );

      const read = async () => {
        const result = await getOwnCollection(a, collectionId, deps());

        return result.status === "ok" ? result.value : null;
      };

      expect((await read())?.progress).toEqual({ visited: 1, total: 2 });

      await f.setStatus(cur, curatorCollection, "draft");

      const hidden = await read();

      expect(hidden?.entries.map((entry) => entry.state)).toEqual(["unavailable", "unavailable"]);
      expect(hidden?.progress).toEqual({ visited: 0, total: 0 });
      expect(hidden?.entries.every((entry) => entry.place === null)).toBe(true);

      await f.setStatus(cur, curatorCollection, "published");
      expect((await read())?.progress).toEqual({ visited: 1, total: 2 });
    });

    it("removes an entry of the owner and nobody else's", async () => {
      const { placeIds } = await f.publishedCollection(cur, orgId, 1);
      const collectionId = await newOwn(a);

      await addPlace(a, collectionId, placeIds[0]!);

      const [item] = await itemRows(collectionId);

      expect(
        await removeEntryFromOwnCollection(b, collectionId, { itemId: item!.id }, deps()),
      ).toEqual({ status: "not_found" });
      expect(
        await removeEntryFromOwnCollection(a, collectionId, { itemId: item!.id }, deps()),
      ).toEqual({ status: "ok", value: { removed: true } });
      expect(await itemRows(collectionId)).toEqual([]);
    });
  });

  describe("the curator deletes a place that is in the collection of an explorer (E8-Q19, B1)", () => {
    // The curator takes the place out of the collections first (places_delete requires it), then
    // deletes it, all as krajozbior_app with FORCE: the foreign key sets place_id to null.
    async function curatorDeletesPlace(collectionId: string, placeId: string) {
      await f.setStatus(cur, collectionId, "draft");
      await as(cur, `delete from public.collection_places where place_id = ?`, [placeId]);

      return as(cur, `delete from public.places where id = ? returning id`, [placeId]);
    }

    it("goes through, leaves the name, and shows the entry as removed (criterion 25)", async () => {
      const { collectionId: curatorCollection, placeIds } = await f.publishedCollection(
        cur,
        orgId,
        2,
      );
      const own = await newOwn(a);
      const other = await newOwn(b);

      await addPlace(a, own, placeIds[0]!);
      await addPlace(a, own, placeIds[1]!);
      await addPlace(b, other, placeIds[0]!);

      await f.setStatus(cur, curatorCollection, "draft");
      await as(cur, `delete from public.collection_places where place_id = ?`, [placeIds[0]]);

      expect(
        await as(cur, `delete from public.places where id = ? returning id`, [placeIds[0]]),
      ).toHaveLength(1);

      for (const collectionId of [own, other]) {
        const [first] = await itemRows(collectionId);

        expect(first).toMatchObject({ place_id: null, place_name_snapshot: "Miejsce" });
      }

      const view = await getOwnCollection(a, own, deps());

      expect(view.status === "ok" ? view.value.entries.map((entry) => entry.state) : []).toEqual([
        "removed",
        "unavailable",
      ]);
      expect(view.status === "ok" ? view.value.progress : null).toEqual({ visited: 0, total: 0 });

      // "Usuń z kolekcji" works for the removed entry as for any other.
      const removedId = (await itemRows(own))[0]!.id;

      expect(await removeEntryFromOwnCollection(a, own, { itemId: removedId }, deps())).toEqual({
        status: "ok",
        value: { removed: true },
      });
    });

    it("works for a place that is alone in the collection of an explorer too", async () => {
      const { collectionId, placeIds } = await f.publishedCollection(cur, orgId, 1);
      const own = await newOwn(a);

      await addPlace(a, own, placeIds[0]!);

      expect(await curatorDeletesPlace(collectionId, placeIds[0]!)).toHaveLength(1);
      expect((await itemRows(own))[0]!.place_id).toBeNull();
    });

    it("makes an entry with a place and no name impossible, and an entry with neither too (23514)", async () => {
      const { placeIds } = await f.publishedCollection(cur, orgId, 1);
      const own = await newOwn(a);

      await addPlace(a, own, placeIds[0]!);

      // The superuser of the test container skips RLS, but not the CHECK constraints.
      await expect(
        admin$(
          `update public.user_collection_items set place_name_snapshot = null where user_collection_id = $1`,
          [own],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        admin$(
          `update public.user_collection_items set place_id = null, place_name_snapshot = null
            where user_collection_id = $1`,
          [own],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("deleting an account (E8-Q6, D-E9-4)", () => {
    it("removes the collections and entries of the person, and only theirs", async () => {
      const { placeIds } = await f.publishedCollection(cur, orgId, 1);
      const mine = await newOwn({ ...leaver, role: "user" });
      const theirs = await newOwn(b);

      await addPlace({ ...leaver, role: "user" }, mine, placeIds[0]!);
      await addPlace(b, theirs, placeIds[0]!);

      expect(await deleteAccountRows(authPool, leaver.id)).toBe(true);

      expect(await admin$(`select 1 from public.user_collections where id = $1`, [mine])).toEqual(
        [],
      );
      expect(await itemRows(mine)).toEqual([]);
      expect(await itemRows(theirs)).toHaveLength(1);
    });
  });

  describe("deleting a collection", () => {
    it("removes its entries and leaves the visits of the owner (R-07)", async () => {
      const { placeIds } = await f.publishedCollection(cur, orgId, 1);
      const collectionId = await newOwn(a);

      await addPlace(a, collectionId, placeIds[0]!);
      await admin$(
        `insert into public.visits (user_id, place_id, kind, date_precision)
         values ($1, $2, 'past', 'unknown') on conflict do nothing`,
        [explorerA.id, placeIds[0]],
      );

      expect(await deleteOwnCollection(a, collectionId, deps())).toEqual({
        status: "ok",
        value: { deleted: true },
      });
      expect(await itemRows(collectionId)).toEqual([]);
      expect(
        await admin$(`select 1 from public.visits where user_id = $1 and place_id = $2`, [
          explorerA.id,
          placeIds[0],
        ]),
      ).toHaveLength(1);
    });
  });
});
