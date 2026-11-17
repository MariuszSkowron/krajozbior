import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOrmConfig } from "@/lib/db/config";
import { albumFixtures, newUser, rejectedByPolicy } from "../support/album-fixtures";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// E2, PR5: saved_collections and want_to_see_places on the real database
// (docs/data-isolation.md, class PRIV). `app` is a pooled connection as
// krajozbior_app (max 1 connection, so a leaked context would show).
const TABLES = ["public.saved_collections", "public.want_to_see_places"];

let db: ScratchDatabase;
let app: MikroORM;

const explorerA = newUser("explorer-a");
const explorerB = newUser("explorer-b");
const curA = newUser("cur-a"); // member of orgA
const curS = newUser("cur-s"); // member of orgS (suspended in tests)

let orgA = "";
let orgS = "";

const f = albumFixtures({ db: () => db, app: () => app });
const { admin$, as, asGuest } = f;

const save = (actor: { id: string }, collectionId: string) =>
  as(
    actor,
    `insert into public.saved_collections (user_id, collection_id)
     values (app_current_user_id(), ?)`,
    [collectionId],
  );
const want = (actor: { id: string }, placeId: string) =>
  as(
    actor,
    `insert into public.want_to_see_places (user_id, place_id)
     values (app_current_user_id(), ?)`,
    [placeId],
  );
// The saves of the actor for one collection (tests share the database, so each asks about its own).
const savedBy = (actor: { id: string }, collectionId: string) =>
  as(actor, `select collection_id from public.saved_collections where collection_id = ?`, [
    collectionId,
  ]);

describe("saved collections and the want-to-see list", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_album");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, curA, curS]);
    orgA = await f.newOrganization("Gmina A", "gmina-a", [curA]);
    orgS = await f.newOrganization("Gmina S", "gmina-s", [curS]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("has row security enabled, forced and policies on both tables, and a safe app role", async () => {
    const gaps = await withClient(db.adminUrl, async (client) => [
      ...(await findRowLevelSecurityGaps(client, TABLES)),
      ...(await findApplicationRoleGaps(client)),
    ]);

    expect(gaps).toEqual([]);
  });

  it("gives krajozbior_app select, insert and delete only, and no other role anything", async () => {
    for (const table of ["saved_collections", "want_to_see_places"]) {
      const [p] = await admin$<Record<string, boolean>>(
        `select
           has_table_privilege('krajozbior_app', $1, 'select, insert, delete') as app_ok,
           has_table_privilege('krajozbior_app', $1, 'update, truncate, references, trigger') as app_bad,
           has_any_column_privilege('krajozbior_app', $1, 'update') as app_update,
           has_any_column_privilege('krajozbior_auth', $1, 'select, insert, update') as auth_any,
           has_any_column_privilege('krajozbior_ops', $1, 'select, insert, update') as ops_any`,
        [`public.${table}`],
      );

      expect(p).toEqual({
        app_ok: true,
        app_bad: false,
        app_update: false,
        auth_any: false,
        ops_any: false,
      });
    }
  });

  it("shows nothing and accepts no write without a user context", async () => {
    const { collectionId, placeIds } = await f.publishedCollection(curA, orgA);

    for (const table of TABLES) {
      expect(await asGuest(`select * from ${table}`)).toEqual([]);
    }
    await expect(
      app.em.execute(
        `insert into public.saved_collections (user_id, collection_id) values (?, ?)`,
        [explorerA.id, collectionId],
      ),
    ).rejects.toThrow(rejectedByPolicy);
    await expect(
      app.em.execute(`insert into public.want_to_see_places (user_id, place_id) values (?, ?)`, [
        explorerA.id,
        placeIds[0],
      ]),
    ).rejects.toThrow(rejectedByPolicy);
  });

  describe("explorer A against explorer B", () => {
    it("keeps saved collections private, also for raw SQL", async () => {
      const { collectionId } = await f.publishedCollection(curA, orgA);

      await save(explorerA, collectionId);

      expect(await savedBy(explorerA, collectionId)).toEqual([{ collection_id: collectionId }]);
      expect(await savedBy(explorerB, collectionId)).toEqual([]);
      expect(
        await as(
          explorerB,
          `select * from public.saved_collections where user_id = ? and collection_id = ?`,
          [explorerA.id, collectionId],
        ),
      ).toEqual([]);
      // B changes and removes nothing of A.
      expect(
        await as(
          explorerB,
          `delete from public.saved_collections where collection_id = ? returning *`,
          [collectionId],
        ),
      ).toEqual([]);
      await expect(
        as(
          explorerB,
          `insert into public.saved_collections (user_id, collection_id) values (?, ?)`,
          [explorerA.id, collectionId],
        ),
      ).rejects.toThrow(rejectedByPolicy);
      expect(await savedBy(explorerA, collectionId)).toHaveLength(1);
      // The owner can remove their own, and it is idempotent in effect.
      expect(
        await as(
          explorerA,
          `delete from public.saved_collections where collection_id = ? returning *`,
          [collectionId],
        ),
      ).toHaveLength(1);
    });

    it("keeps the want-to-see list private, also for raw SQL", async () => {
      const { placeIds } = await f.publishedCollection(curA, orgA);

      await want(explorerA, placeIds[0]!);

      expect(await as(explorerA, `select place_id from public.want_to_see_places`)).toEqual([
        { place_id: placeIds[0] },
      ]);
      expect(await as(explorerB, `select * from public.want_to_see_places`)).toEqual([]);
      expect(
        await as(
          explorerB,
          `delete from public.want_to_see_places where place_id = ? returning *`,
          [placeIds[0]],
        ),
      ).toEqual([]);
      await expect(
        as(explorerB, `insert into public.want_to_see_places (user_id, place_id) values (?, ?)`, [
          explorerA.id,
          placeIds[0],
        ]),
      ).rejects.toThrow(rejectedByPolicy);
      // Nobody changes a row: there is no UPDATE grant at all.
      await expect(
        as(explorerA, `update public.want_to_see_places set saved_at = now()`),
      ).rejects.toThrow(/permission denied/);
    });

    it("gives a curator no path to the saves of explorers (R-09)", async () => {
      const { collectionId, placeIds } = await f.publishedCollection(curA, orgA);

      await save(explorerA, collectionId);
      await want(explorerA, placeIds[0]!);

      expect(await as(curA, `select * from public.saved_collections`)).toEqual([]);
      expect(await as(curA, `select * from public.want_to_see_places`)).toEqual([]);
      expect(
        await as(curA, `delete from public.saved_collections where collection_id = ? returning *`, [
          collectionId,
        ]),
      ).toEqual([]);
    });
  });

  describe("only publicly visible collections and places can be saved (W2)", () => {
    it("refuses a draft collection, also to a member of its organization", async () => {
      const { collectionId, placeIds } = await f.draftCollection(curA, orgA);

      await expect(save(explorerA, collectionId)).rejects.toThrow(rejectedByPolicy);
      // The curator sees the draft, and still cannot save it or want to see its place.
      expect(
        await as(curA, `select id from public.collections where id = ?`, [collectionId]),
      ).toHaveLength(1);
      await expect(save(curA, collectionId)).rejects.toThrow(rejectedByPolicy);
      await expect(want(explorerA, placeIds[0]!)).rejects.toThrow(rejectedByPolicy);
      await expect(want(curA, placeIds[0]!)).rejects.toThrow(rejectedByPolicy);
      expect(
        await admin$(`select * from public.saved_collections where collection_id = $1`, [
          collectionId,
        ]),
      ).toEqual([]);
    });

    it("refuses a collection that does not exist", async () => {
      await expect(save(explorerA, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
        rejectedByPolicy,
      );
      await expect(want(explorerA, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
        rejectedByPolicy,
      );
    });

    it("accepts a place that is in at least one published collection, even if another is a draft", async () => {
      const { placeIds } = await f.publishedCollection(curA, orgA);
      const draft = await f.newCollection(curA, orgA);

      await f.link(curA, draft, placeIds[0]!, orgA);

      expect(await want(explorerA, placeIds[0]!)).toBeDefined();
    });

    it("refuses a collection and a place of a suspended organization, and of a withdrawn collection", async () => {
      const suspended = await f.publishedCollection(curS, orgS);
      const withdrawn = await f.publishedCollection(curA, orgA);

      await f.setStatus(curA, withdrawn.collectionId, "draft");
      await f.suspendOrganization(orgS);
      try {
        await expect(save(explorerA, suspended.collectionId)).rejects.toThrow(rejectedByPolicy);
        await expect(want(explorerA, suspended.placeIds[0]!)).rejects.toThrow(rejectedByPolicy);
      } finally {
        await f.approveOrganization(orgS);
      }
      await expect(save(explorerA, withdrawn.collectionId)).rejects.toThrow(rejectedByPolicy);
      await expect(want(explorerA, withdrawn.placeIds[0]!)).rejects.toThrow(rejectedByPolicy);
    });
  });

  describe("saves of explorers outlive the visibility of the collection (condition of the PR2 review)", () => {
    it("keeps saves after the publication is withdrawn and after the organization is suspended, and they return", async () => {
      const { collectionId } = await f.publishedCollection(curS, orgS);

      await save(explorerA, collectionId);
      await save(explorerB, collectionId);

      // The curator withdraws the publication: the collection is hidden from the
      // explorers, the saves stay and come back after publishing again.
      await f.setStatus(curS, collectionId, "draft");
      expect(
        await as(explorerA, `select id from public.collections where id = ?`, [collectionId]),
      ).toEqual([]);
      expect(await savedBy(explorerA, collectionId)).toEqual([{ collection_id: collectionId }]);
      expect(await savedBy(explorerB, collectionId)).toEqual([{ collection_id: collectionId }]);

      await f.setStatus(curS, collectionId, "published");
      expect(
        await as(explorerA, `select id from public.collections where id = ?`, [collectionId]),
      ).toHaveLength(1);

      // The organization is suspended: same.
      await f.suspendOrganization(orgS);
      try {
        expect(
          await as(explorerA, `select id from public.collections where id = ?`, [collectionId]),
        ).toEqual([]);
        expect(
          await asGuest(`select id from public.collections where id = ?`, [collectionId]),
        ).toEqual([]);
        expect(await savedBy(explorerA, collectionId)).toEqual([{ collection_id: collectionId }]);
        expect(await savedBy(explorerB, collectionId)).toEqual([{ collection_id: collectionId }]);
        // While hidden, nobody can save it anew, but the owner can still remove a save.
        await expect(save(curA, collectionId)).rejects.toThrow(rejectedByPolicy);
      } finally {
        await f.approveOrganization(orgS);
      }

      expect(
        await as(explorerA, `select id from public.collections where id = ?`, [collectionId]),
      ).toHaveLength(1);
      expect(await savedBy(explorerA, collectionId)).toEqual([{ collection_id: collectionId }]);
      expect(
        await as(
          explorerA,
          `delete from public.saved_collections where collection_id = ? returning *`,
          [collectionId],
        ),
      ).toHaveLength(1);
      expect(await savedBy(explorerB, collectionId)).toHaveLength(1);
    });

    it("keeps the want-to-see entries too while the place is hidden", async () => {
      const { collectionId, placeIds } = await f.publishedCollection(curA, orgA);

      await want(explorerA, placeIds[0]!);
      await f.setStatus(curA, collectionId, "draft");

      expect(
        await as(explorerA, `select place_id from public.want_to_see_places where place_id = ?`, [
          placeIds[0],
        ]),
      ).toEqual([{ place_id: placeIds[0] }]);
      expect(
        await as(explorerA, `select id from public.places where id = ?`, [placeIds[0]]),
      ).toEqual([]);
    });

    it("cannot delete a collection that has a save: not through the DELETE policy, and not at all (on delete restrict)", async () => {
      const { collectionId } = await f.publishedCollection(curS, orgS);

      await save(explorerA, collectionId);

      // Policy: a collection that was ever published is not deletable, even after withdrawing.
      await f.setStatus(curS, collectionId, "draft");
      expect(
        await as(curS, `delete from public.collections where id = ? returning id`, [collectionId]),
      ).toEqual([]);
      // Foreign key: even a role that bypasses row policies cannot remove it.
      await expect(
        admin$(`delete from public.collections where id = $1`, [collectionId]),
      ).rejects.toThrow(/violates foreign key constraint/);

      expect(await savedBy(explorerA, collectionId)).toEqual([{ collection_id: collectionId }]);
    });
  });

  it("does not leak the actor to the next transaction on the same connection", async () => {
    const { collectionId } = await f.publishedCollection(curA, orgA);

    await save(explorerA, collectionId);

    expect(await asGuest(`select * from public.saved_collections`)).toEqual([]);
    expect(await savedBy(explorerB, collectionId)).toEqual([]);
    expect(await app.em.execute(`select app_current_user_id() as id`, [], "get")).toEqual({
      id: null,
    });
  });
});
