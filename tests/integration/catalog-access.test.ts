import { randomInt, randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import {
  addPlace,
  removePlaceFromCollection,
  reorderPlaces,
  updatePlace,
} from "@/features/catalog/application/curator-places";
import {
  createCollection,
  deleteDraftCollection,
  publishCollection,
  unpublishCollection,
  updateCollection,
} from "@/features/catalog/application/curator-collections";
import {
  getPublishedCollection,
  getPublishedPlace,
} from "@/features/catalog/application/public-catalog";
import { COLLECTION_STATUSES, REGIONS } from "@/features/catalog/domain/collection";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import {
  DEMO_COLLECTION_TITLE,
  seedDemoCatalog,
} from "@/features/catalog/infrastructure/seed-demo-catalog";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// E1, PR2: collections, places and collection_places on the real database
// (docs/data-isolation.md). `app` is a pooled connection as krajozbior_app
// (max 1 connection, so a leaked context would show). The superuser connection
// only prepares rows and reads the catalog. Routes are exercised at the end
// through the real route modules with the session and the database wired in.
const TABLES = ["public.collections", "public.places", "public.collection_places"];
const rejectedByPolicy = /row-level security/;
const noPermission = /permission denied/;

let db: ScratchDatabase;
let app: MikroORM;

const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.com` });
const curA = user("cur-a");
const curA2 = user("cur-a2");
const curB = user("cur-b");
const explorer = user("explorer");
const outsider = user("outsider");
const actors = { curA, curA2, curB, explorer, outsider };

let orgA = "";
let orgB = "";
let orgS = ""; // suspended later in a test

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

const as = (actor: { id: string }, sql: string, params: unknown[] = []) =>
  runInUserContext(app.em, actor, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));
const asGuest = (sql: string, params: unknown[] = []) =>
  runInGuestContext(app.em, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));

let counter = 0;
const slug = () => `kolekcja-${(counter += 1)}`;

const newCollection = async (
  actor: { id: string },
  organizationId: string,
  title = "Kolekcja",
): Promise<string> =>
  (
    await as(
      actor,
      `insert into public.collections (slug, organization_id, title, region)
       values (?, ?, ?, 'pomorskie') returning id`,
      [slug(), organizationId, title],
    )
  )[0]!.id as string;

const newPlace = async (
  actor: { id: string },
  organizationId: string,
  name = "Miejsce",
): Promise<string> =>
  (
    await as(
      actor,
      `insert into public.places (organization_id, name, latitude, longitude)
       values (?, ?, 54.1, 18.7) returning id`,
      [organizationId, name],
    )
  )[0]!.id as string;

const link = (
  actor: { id: string },
  collectionId: string,
  placeId: string,
  organizationId: string,
  position = 1,
) =>
  as(
    actor,
    `insert into public.collection_places (collection_id, place_id, organization_id, position)
     values (?, ?, ?, ?)`,
    [collectionId, placeId, organizationId, position],
  );

const publish = (actor: { id: string }, collectionId: string) =>
  as(actor, `update public.collections set status = 'published' where id = ? returning id`, [
    collectionId,
  ]);

// A published collection with `placeCount` places of organization `organizationId`.
async function publishedCollection(
  actor: { id: string },
  organizationId: string,
  placeCount = 1,
): Promise<{ collectionId: string; placeIds: string[] }> {
  const collectionId = await newCollection(actor, organizationId);
  const placeIds: string[] = [];

  for (let i = 1; i <= placeCount; i += 1) {
    const placeId = await newPlace(actor, organizationId, `Miejsce ${i}`);

    await link(actor, collectionId, placeId, organizationId, i);
    placeIds.push(placeId);
  }
  await publish(actor, collectionId);

  return { collectionId, placeIds };
}

const rowOf = async (id: string) =>
  (
    await admin$<Record<string, unknown>>(`select * from public.collections where id = $1`, [id])
  )[0]!;

let limiterAllows = true;
const deps: CatalogDeps = {
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  withGuestContext: (work) => runInGuestContext(app.em, work),
  limiter: {
    reserve: async () =>
      limiterAllows ? { allowed: true } : { allowed: false, retryAfterSeconds: 42 },
  },
  repository: postgresCatalogRepository,
  random: (max) => randomInt(max),
};
const asActor = (actor: { id: string }) => ({ id: actor.id, role: "user" as const });

describe("collections, places and their links", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_catalog");
    await db.migrate();

    for (const { id, email } of Object.values(actors)) {
      await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
        id,
        email.split("@")[0],
        email,
      ]);
    }

    const org = async (name: string, slugValue: string, members: { id: string }[]) => {
      const [{ id }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ($1, $2, 'municipality') returning id`,
        [name, slugValue],
      );

      for (const member of members) {
        await admin$(
          `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
          [id, member.id],
        );
      }

      return id;
    };

    orgA = await org("Gmina A", "gmina-a", [curA, curA2]);
    orgB = await org("Gmina B", "gmina-b", [curB]);
    orgS = await org("Gmina S", "gmina-s", [curB]);

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  beforeEach(() => {
    limiterAllows = true;
  });

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("has row security enabled, forced and policies on all three tables, and a safe app role", async () => {
    const gaps = await withClient(db.adminUrl, async (client) => [
      ...(await findRowLevelSecurityGaps(client, TABLES)),
      ...(await findApplicationRoleGaps(client)),
    ]);

    expect(gaps).toEqual([]);
  });

  it("gives krajozbior_app exactly the intended privileges and no other role any", async () => {
    const [p] = await admin$<Record<string, boolean>>(
      `select
         has_table_privilege('krajozbior_app', 'collections', 'select') as c_select,
         has_table_privilege('krajozbior_app', 'collections', 'delete') as c_delete,
         has_table_privilege('krajozbior_app', 'collections', 'insert, update, truncate, references, trigger') as c_table_write,
         has_column_privilege('krajozbior_app', 'collections', 'first_published_at', 'insert, update') as c_first,
         has_column_privilege('krajozbior_app', 'collections', 'published_at', 'insert, update') as c_published,
         has_column_privilege('krajozbior_app', 'collections', 'slug', 'update') as c_slug_update,
         has_column_privilege('krajozbior_app', 'collections', 'organization_id', 'update') as c_org_update,
         has_column_privilege('krajozbior_app', 'collections', 'id', 'insert, update') as c_id,
         has_column_privilege('krajozbior_app', 'collections', 'status', 'insert, update') as c_status,
         has_column_privilege('krajozbior_app', 'collections', 'title', 'insert, update') as c_title,
         has_table_privilege('krajozbior_app', 'places', 'select') as p_select,
         has_table_privilege('krajozbior_app', 'places', 'delete, truncate, references, trigger') as p_bad,
         has_column_privilege('krajozbior_app', 'places', 'organization_id', 'update') as p_org_update,
         has_column_privilege('krajozbior_app', 'places', 'latitude', 'insert, update') as p_lat,
         has_table_privilege('krajozbior_app', 'collection_places', 'select') as l_select,
         has_table_privilege('krajozbior_app', 'collection_places', 'delete') as l_delete,
         has_table_privilege('krajozbior_app', 'collection_places', 'truncate, references, trigger') as l_bad,
         has_column_privilege('krajozbior_app', 'collection_places', 'position', 'update') as l_pos,
         has_column_privilege('krajozbior_app', 'collection_places', 'collection_id', 'update') as l_coll_update,
         has_column_privilege('krajozbior_app', 'collection_places', 'place_id', 'update') as l_place_update,
         has_any_column_privilege('krajozbior_auth', 'collections', 'select, insert, update') as auth_c,
         has_any_column_privilege('krajozbior_ops', 'collections', 'select, insert, update') as ops_c,
         has_any_column_privilege('krajozbior_ops', 'places', 'select, insert, update') as ops_p,
         has_any_column_privilege('krajozbior_ops', 'collection_places', 'select, insert, update') as ops_l`,
    );

    expect(p).toEqual({
      c_select: true,
      c_delete: true,
      c_table_write: false,
      c_first: false,
      c_published: false,
      // D-27: the address may be set once, at the first publication; a trigger
      // keeps it fixed in every other update.
      c_slug_update: true,
      c_org_update: false,
      c_id: false,
      c_status: true,
      c_title: true,
      p_select: true,
      p_bad: false,
      p_org_update: false,
      p_lat: true,
      l_select: true,
      l_delete: true,
      l_bad: false,
      l_pos: true,
      l_coll_update: false,
      l_place_update: false,
      auth_c: false,
      ops_c: false,
      ops_p: false,
      ops_l: false,
    });
  });

  it("shows nothing and accepts no write without a user context", async () => {
    for (const table of TABLES) {
      expect(await asGuest(`select * from ${table}`)).toEqual([]);
    }
    // The guest transaction is read only.
    await expect(
      asGuest(
        `insert into public.places (organization_id, name, latitude, longitude) values (?, 'x', 1, 1)`,
        [orgA],
      ),
    ).rejects.toThrow(/read-only/);
    await expect(
      app.em.execute(
        `insert into public.places (organization_id, name, latitude, longitude) values (?, 'x', 1, 1)`,
        [orgA],
      ),
    ).rejects.toThrow(rejectedByPolicy);
  });

  it("lets a member of the organization create a draft, a place and a link", async () => {
    const collectionId = await newCollection(curA, orgA, "Wieże");
    const placeId = await newPlace(curA, orgA);

    await link(curA, collectionId, placeId, orgA);

    expect(await rowOf(collectionId)).toMatchObject({
      status: "draft",
      version: 1,
      first_published_at: null,
      published_at: null,
    });
    // Another member of the same organization edits the same content.
    expect(
      await as(curA2, `update public.collections set title = 'Nowa' where id = ? returning id`, [
        collectionId,
      ]),
    ).toHaveLength(1);
  });

  it("does not let an account without membership write anything", async () => {
    await expect(
      as(
        outsider,
        `insert into public.collections (slug, organization_id, title, region) values (?, ?, 't', 'pomorskie')`,
        [slug(), orgA],
      ),
    ).rejects.toThrow(rejectedByPolicy);
    await expect(
      as(
        explorer,
        `insert into public.places (organization_id, name, latitude, longitude) values (?, 'x', 1, 1)`,
        [orgA],
      ),
    ).rejects.toThrow(rejectedByPolicy);
  });

  describe("publication columns (D-T5, W1, V1, S1)", () => {
    it("never lets a curator insert a collection as published", async () => {
      await expect(
        as(
          curA,
          `insert into public.collections (slug, organization_id, title, region, status)
           values (?, ?, 't', 'pomorskie', 'published')`,
          [slug(), orgA],
        ),
      ).rejects.toThrow(rejectedByPolicy);
    });

    it("refuses an INSERT or UPDATE that names a publication column (no grant)", async () => {
      await expect(
        as(
          curA,
          `insert into public.collections (slug, organization_id, title, region, first_published_at, published_at)
           values (?, ?, 't', 'pomorskie', now(), now())`,
          [slug(), orgA],
        ),
      ).rejects.toThrow(noPermission);

      const id = await newCollection(curA, orgA);

      for (const column of ["first_published_at", "published_at"]) {
        await expect(
          as(curA, `update public.collections set ${column} = null where id = ?`, [id]),
        ).rejects.toThrow(noPermission);
      }
    });

    it("zeroes publication dates given with a draft by a role that skips the grants", async () => {
      const [{ id }] = await admin$<{ id: string }>(
        `insert into public.collections (slug, organization_id, title, region, status, first_published_at, published_at)
         values ($1, $2, 't', 'pomorskie', 'draft', now(), now()) returning id`,
        [slug(), orgA],
      );

      expect(await rowOf(id)).toMatchObject({ first_published_at: null, published_at: null });
    });

    it("stamps both dates when a role that skips the policies inserts a published collection (S1)", async () => {
      const [{ id }] = await admin$<{ id: string }>(
        `insert into public.collections (slug, organization_id, title, region, status)
         values ($1, $2, 't', 'pomorskie', 'published') returning id`,
        [slug(), orgA],
      );
      const row = await rowOf(id);

      expect(row.first_published_at).toBeInstanceOf(Date);
      expect(row.published_at).toEqual(row.first_published_at);
    });

    it("has an invariant that refuses a published collection without dates (trigger off, rolled back)", async () => {
      const result = await withClient(db.adminUrl, async (client) => {
        await client.query("begin");
        try {
          await client.query(
            `alter table public.collections disable trigger zz_collections_publication`,
          );
          await client.query(
            `insert into public.collections (slug, organization_id, title, region, status)
             values ($1, $2, 't', 'pomorskie', 'published')`,
            [slug(), orgA],
          );

          return "accepted";
        } catch (error) {
          return (error as { code?: string }).code;
        } finally {
          await client.query("rollback");
        }
      });

      expect(result).toBe("23514");
      // The rollback also restored the trigger.
      expect(
        await admin$(
          `select 1 from pg_trigger where tgname = 'zz_collections_publication' and tgenabled = 'O'`,
        ),
      ).toHaveLength(1);
    });

    it("sets first_published_at once; withdrawing keeps it; republishing moves only published_at", async () => {
      const { collectionId } = await publishedCollection(curA, orgA);
      const first = await rowOf(collectionId);

      expect(first).toMatchObject({ status: "published", version: 1 });
      expect(first.first_published_at).toEqual(first.published_at);

      await as(curA, `update public.collections set status = 'draft' where id = ?`, [collectionId]);
      const withdrawn = await rowOf(collectionId);

      expect(withdrawn.first_published_at).toEqual(first.first_published_at);
      expect(withdrawn.published_at).toEqual(first.published_at);

      await publish(curA, collectionId);
      const again = await rowOf(collectionId);

      expect(again.first_published_at).toEqual(first.first_published_at);
      expect((again.published_at as Date).getTime()).toBeGreaterThan(
        (first.published_at as Date).getTime(),
      );
    });

    it("does not move published_at when a published collection is saved with the same status (V3)", async () => {
      const { collectionId } = await publishedCollection(curA, orgA);
      const before = await rowOf(collectionId);

      await as(
        curA,
        `update public.collections set title = 'Zmiana', status = 'published' where id = ?`,
        [collectionId],
      );

      expect(await rowOf(collectionId)).toMatchObject({
        published_at: before.published_at,
        first_published_at: before.first_published_at,
      });
    });

    it("cannot delete a collection that was published once, even when withdrawn; a fresh draft can go", async () => {
      const { collectionId } = await publishedCollection(curA, orgA);

      await as(curA, `update public.collections set status = 'draft' where id = ?`, [collectionId]);
      expect(
        await as(curA, `delete from public.collections where id = ? returning id`, [collectionId]),
      ).toHaveLength(0);
      expect(
        await admin$(`select 1 from public.collections where id = $1`, [collectionId]),
      ).toHaveLength(1);

      const draft = await newCollection(curA, orgA);
      const placeId = await newPlace(curA, orgA);

      await link(curA, draft, placeId, orgA);
      expect(
        await as(curA, `delete from public.collections where id = ? returning id`, [draft]),
      ).toHaveLength(1);
      // The links of a deleted draft go with it; the place stays.
      expect(
        await admin$(`select 1 from public.collection_places where collection_id = $1`, [draft]),
      ).toHaveLength(0);
      expect(await admin$(`select 1 from public.places where id = $1`, [placeId])).toHaveLength(1);
    });
  });

  describe("organization A against organization B", () => {
    let draftA = "";
    let placeA = "";

    beforeAll(async () => {
      draftA = await newCollection(curA, orgA, "Szkic A");
      placeA = await newPlace(curA, orgA, "Miejsce szkicu A");
      await link(curA, draftA, placeA, orgA);
    });

    it("hides the draft, its place and its links from curator B (0 rows)", async () => {
      expect(await as(curB, `select id from public.collections where id = ?`, [draftA])).toEqual(
        [],
      );
      expect(await as(curB, `select id from public.places where id = ?`, [placeA])).toEqual([]);
      expect(
        await as(curB, `select 1 from public.collection_places where collection_id = ?`, [draftA]),
      ).toEqual([]);
    });

    it("changes and deletes nothing of A for curator B (0 rows)", async () => {
      expect(
        await as(curB, `update public.collections set title = 'x' where id = ? returning id`, [
          draftA,
        ]),
      ).toEqual([]);
      expect(
        await as(curB, `delete from public.collections where id = ? returning id`, [draftA]),
      ).toEqual([]);
      expect(
        await as(curB, `update public.places set name = 'x' where id = ? returning id`, [placeA]),
      ).toEqual([]);
      expect(
        await as(
          curB,
          `update public.collection_places set position = 9 where collection_id = ? returning 1`,
          [draftA],
        ),
      ).toEqual([]);
      expect(
        await as(curB, `delete from public.collection_places where collection_id = ? returning 1`, [
          draftA,
        ]),
      ).toEqual([]);
      expect(await rowOf(draftA)).toMatchObject({ title: "Szkic A", version: 1 });
    });

    it("refuses curator B to write into organization A (42501)", async () => {
      await expect(
        as(
          curB,
          `insert into public.collections (slug, organization_id, title, region) values (?, ?, 't', 'pomorskie')`,
          [slug(), orgA],
        ),
      ).rejects.toThrow(rejectedByPolicy);
      await expect(
        as(
          curB,
          `insert into public.places (organization_id, name, latitude, longitude) values (?, 'x', 1, 1)`,
          [orgA],
        ),
      ).rejects.toThrow(rejectedByPolicy);
      await expect(link(curB, draftA, placeA, orgA, 2)).rejects.toThrow(rejectedByPolicy);
    });

    it("does not let B add place A to its own collection, nor its place to collection A", async () => {
      const draftB = await newCollection(curB, orgB);
      const placeB = await newPlace(curB, orgB);

      // Keys carry the organization: the link would need A's place under B's id.
      await expect(link(curB, draftB, placeA, orgB)).rejects.toThrow(/foreign key/);
      await expect(link(curB, draftA, placeB, orgB)).rejects.toThrow(/foreign key/);
      await expect(link(curB, draftA, placeB, orgA)).rejects.toThrow(rejectedByPolicy);
    });

    it("lets everyone read published content only, and the place of a published collection", async () => {
      const { collectionId, placeIds } = await publishedCollection(curA, orgA);

      for (const read of [
        (sql: string, params: unknown[]) => asGuest(sql, params),
        (sql: string, params: unknown[]) => as(explorer, sql, params),
        (sql: string, params: unknown[]) => as(curB, sql, params),
      ]) {
        expect(
          await read(`select id from public.collections where id = ?`, [collectionId]),
        ).toHaveLength(1);
        expect(await read(`select id from public.collections where id = ?`, [draftA])).toHaveLength(
          0,
        );
        expect(await read(`select id from public.places where id = ?`, [placeIds[0]])).toHaveLength(
          1,
        );
        expect(await read(`select id from public.places where id = ?`, [placeA])).toHaveLength(0);
        expect(
          await read(`select 1 from public.collection_places where collection_id = ?`, [
            collectionId,
          ]),
        ).toHaveLength(1);
        expect(
          await read(`select 1 from public.collection_places where collection_id = ?`, [draftA]),
        ).toHaveLength(0);
      }
      // A member sees the own draft too.
      expect(
        await as(curA2, `select id from public.collections where id = ?`, [draftA]),
      ).toHaveLength(1);
    });

    it("hides a collection after it is withdrawn and after the organization is suspended", async () => {
      const { collectionId, placeIds } = await publishedCollection(curB, orgS);
      const visible = async () =>
        (await asGuest(`select id from public.collections where id = ?`, [collectionId])).length +
        (await asGuest(`select id from public.places where id = ?`, [placeIds[0]])).length;

      expect(await visible()).toBe(2);

      await as(curB, `update public.collections set status = 'draft' where id = ?`, [collectionId]);
      expect(await visible()).toBe(0);
      await publish(curB, collectionId);
      expect(await visible()).toBe(2);

      await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgS]);
      expect(await visible()).toBe(0);
      expect(
        await as(explorer, `select id from public.collections where id = ?`, [collectionId]),
      ).toEqual([]);
      // The suspended organization's curator loses the right to write (and to see its drafts).
      expect(
        await as(curB, `update public.collections set title = 'x' where id = ? returning id`, [
          collectionId,
        ]),
      ).toEqual([]);
      await expect(newCollection(curB, orgS)).rejects.toThrow(rejectedByPolicy);

      await admin$(`update public.organizations set status = 'approved' where id = $1`, [orgS]);
      expect(await visible()).toBe(2);
    });
  });

  describe("composite keys, positions and constraints", () => {
    it("keeps positions unique per collection, checked at the end of the transaction", async () => {
      const collectionId = await newCollection(curA, orgA);
      const p1 = await newPlace(curA, orgA);
      const p2 = await newPlace(curA, orgA);

      await link(curA, collectionId, p1, orgA, 1);
      await expect(link(curA, collectionId, p2, orgA, 1)).rejects.toThrow(/duplicate key|unique/);
      await link(curA, collectionId, p2, orgA, 2);

      // A swap in one statement passes thanks to the deferred constraint.
      await runInUserContext(app.em, curA, ({ em }) =>
        em.execute(
          `update public.collection_places set position = 3 - position where collection_id = ?`,
          [collectionId],
        ),
      );
      expect(
        (
          await admin$<{ place_id: string }>(
            `select place_id from public.collection_places where collection_id = $1 order by position`,
            [collectionId],
          )
        ).map((row) => row.place_id),
      ).toEqual([p2, p1]);
    });

    it("refuses bad values (CHECK) and a second link of the same place", async () => {
      const collectionId = await newCollection(curA, orgA);
      const placeId = await newPlace(curA, orgA);

      await link(curA, collectionId, placeId, orgA, 1);
      await expect(link(curA, collectionId, placeId, orgA, 2)).rejects.toThrow(
        /duplicate key|unique/,
      );
      await expect(link(curA, collectionId, placeId, orgA, 0)).rejects.toThrow(/check constraint/);
      for (const radius of [49, 2001]) {
        await expect(
          as(
            curA,
            `insert into public.places (organization_id, name, latitude, longitude, visit_radius_m) values (?, 'x', 1, 1, ?)`,
            [orgA, radius],
          ),
        ).rejects.toThrow(/check constraint/);
      }
      await expect(
        as(
          curA,
          `insert into public.places (organization_id, name, latitude, longitude) values (?, 'x', 91, 1)`,
          [orgA],
        ),
      ).rejects.toThrow(/check constraint/);
      await expect(
        as(
          curA,
          `insert into public.collections (slug, organization_id, title, region) values (?, ?, 't', 'atlantyda')`,
          [slug(), orgA],
        ),
      ).rejects.toThrow(/check constraint/);
      expect(
        await as(
          curA,
          `insert into public.places (organization_id, name, latitude, longitude, visit_radius_m) values (?, 'x', 1, 1, 50) returning visit_radius_m`,
          [orgA],
        ),
      ).toEqual([{ visit_radius_m: 50 }]);
    });

    it("keeps the frozen CHECK lists in step with the code", async () => {
      const listOf = async (column: string) => {
        const rows = await admin$<{ def: string }>(
          `select pg_get_constraintdef(c.oid) as def
             from pg_constraint c
            where c.conrelid = 'public.collections'::regclass and c.contype = 'c'`,
        );
        const found = rows.find(({ def }) => def.includes(`(${column} = ANY`));

        return [...(found?.def.matchAll(/'([a-z_]+)'::text/g) ?? [])].map((match) => match[1]);
      };

      expect(await listOf("region")).toEqual([...REGIONS]);
      expect(await listOf("status")).toEqual([...COLLECTION_STATUSES]);
    });
  });

  it("has no infinite recursion of policies on any path (guest, explorer, curators)", async () => {
    const queries = [
      `select count(*) from public.collections`,
      `select count(*) from public.places`,
      `select count(*) from public.collection_places`,
      `select count(*) from public.collections c
         join public.collection_places cp on cp.collection_id = c.id
         join public.places p on p.id = cp.place_id`,
      `select count(*) from public.places p
         left join public.collection_places cp on cp.place_id = p.id
         left join public.collections c on c.id = cp.collection_id`,
    ];

    for (const query of queries) {
      await expect(asGuest(query)).resolves.toBeDefined();
      for (const actor of [explorer, curA, curB]) {
        await expect(as(actor, query)).resolves.toBeDefined();
      }
    }
  });

  it("uses the index on collection_places (place_id) in the SELECT policy of places", async () => {
    await withClient(db.adminUrl, async (client) => {
      await client.query(
        `insert into public.places (id, organization_id, name, latitude, longitude)
         select gen_random_uuid(), $1, 'P' || g, 54 + g / 10000.0, 18 + g / 10000.0
           from generate_series(1, 1000) g`,
        [orgA],
      );
      await client.query(
        `insert into public.collections (slug, organization_id, title, region, status)
         select 'plan-' || g, $1, 'K' || g, 'pomorskie', 'published' from generate_series(1, 50) g`,
        [orgA],
      );
      await client.query(
        `insert into public.collection_places (collection_id, place_id, organization_id, position)
         select c.id, p.id, $1, ((p.rn - 1) % 20) + 1
           from (select id, row_number() over (order by id) as k
                   from public.collections where slug like 'plan-%') c
           join (select id, row_number() over (order by id) as rn
                   from public.places where name ~ '^P[0-9]+$') p
             on ((p.rn - 1) / 20) + 1 = c.k`,
        [orgA],
      );
      await client.query(`analyze public.places, public.collections, public.collection_places`);
    });

    const [{ id: someId }] = await admin$<{ id: string }>(
      `select place_id as id from public.collection_places limit 1`,
    );
    const plan = (await asGuest(`explain select * from public.places where id = ?`, [someId]))
      .map((row) => String(row["QUERY PLAN"]))
      .join("\n");

    expect(plan).toContain("collection_places_place_id_idx");
  });

  it("seeds the sample collection through the curator use cases (draft, then publication), once", async () => {
    const seeder = user("seed-curator");

    await admin$(`insert into auth.users (id, name, email) values ($1, 'seed', $2)`, [
      seeder.id,
      seeder.email,
    ]);
    const [{ id: orgId }] = await admin$<{ id: string }>(
      `insert into public.organizations (name, slug, kind) values ('Seed', 'seed-demo', 'municipality') returning id`,
    );

    await admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [orgId, seeder.id],
    );

    const run = () => seedDemoCatalog(db.urls.krajozbior_app, db.urls.krajozbior_ops, seeder.email);

    expect(await run()).toBe("created");
    expect(await run()).toBe("noop");

    const rows = await admin$<{ status: string; first_published_at: Date | null; places: number }>(
      `select c.status, c.first_published_at,
              (select count(*)::int from public.collection_places cp where cp.collection_id = c.id) as places
         from public.collections c where c.title = $1`,
      [DEMO_COLLECTION_TITLE],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "published", places: 3 });
    expect(rows[0]!.first_published_at).toBeInstanceOf(Date);
    await expect(
      seedDemoCatalog(db.urls.krajozbior_app, db.urls.krajozbior_ops, "nobody@example.com"),
    ).rejects.toThrow(/missing/);
  });

  it("repairs a demo collection left half-made by an earlier run (found by slug, not by title)", async () => {
    const half = user("seed-half");

    await admin$(`insert into auth.users (id, name, email) values ($1, 'seed-half', $2)`, [
      half.id,
      half.email,
    ]);
    const [{ id: orgId }] = await admin$<{ id: string }>(
      `insert into public.organizations (name, slug, kind) values ('Seed half', 'seed-half', 'municipality') returning id`,
    );

    await admin$(
      `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
      [orgId, half.id],
    );
    // The slug is unique in the whole database: clear the sample made by the previous test.
    await admin$(
      `delete from public.collection_places where collection_id in
         (select id from public.collections where slug = 'demo-mosty-i-zamki-nad-wisla')`,
    );
    await admin$(`delete from public.collections where slug = 'demo-mosty-i-zamki-nad-wisla'`);
    // A draft with one place only, as if the run failed after the first place.
    await as(
      half,
      `insert into public.collections (slug, organization_id, title, region)
       values ('demo-mosty-i-zamki-nad-wisla', ?, 'Inny tytuł', 'pomorskie')`,
      [orgId],
    );
    const [{ id: collectionId }] = await admin$<{ id: string }>(
      `select id from public.collections where slug = 'demo-mosty-i-zamki-nad-wisla'`,
    );
    const placeId = await newPlace(half, orgId, "Most Tczewski");

    await link(half, collectionId, placeId, orgId, 1);

    expect(await seedDemoCatalog(db.urls.krajozbior_app, db.urls.krajozbior_ops, half.email)).toBe(
      "created",
    );
    expect(
      await admin$(
        `select c.status, (select count(*)::int from public.collection_places cp where cp.collection_id = c.id) as places
           from public.collections c where c.id = $1`,
        [collectionId],
      ),
    ).toEqual([{ status: "published", places: 3 }]);
    expect(await seedDemoCatalog(db.urls.krajozbior_app, db.urls.krajozbior_ops, half.email)).toBe(
      "noop",
    );
  });

  it("does not carry a user context to the next transaction on the same connection", async () => {
    const inside = await as(curA, "select pg_backend_pid() as pid");
    const after = await asGuest("select pg_backend_pid() as pid");

    expect(after[0]!.pid).toBe(inside[0]!.pid);
    expect(await asGuest(`select app_current_user_id() as "userId"`)).toEqual([{ userId: null }]);
    expect(await asGuest(`select id from public.collections where status = 'draft'`)).toEqual([]);
  });

  describe("use cases", () => {
    it("creates a draft with a generated address in the organization of the actor", async () => {
      const result = await createCollection(
        asActor(curA),
        { title: "Wieże Tczewa", summary: "Opis", region: "pomorskie" },
        deps,
      );

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.value).toMatchObject({
        organizationId: orgA,
        status: "draft",
        version: 1,
        firstPublishedAt: null,
      });
      expect(result.value.slug).toMatch(/^wieze-tczewa-[a-z0-9]{6}$/);
    });

    it("answers unauthenticated, forbidden, invalid and rate limited before touching rows", async () => {
      const body = { title: "T", region: "pomorskie" };

      expect(await createCollection(null, body, deps)).toEqual({ status: "unauthenticated" });
      expect(await createCollection(asActor(explorer), body, deps)).toEqual({
        status: "forbidden",
      });
      expect(
        await createCollection(asActor(curA), { ...body, organizationId: orgB }, deps),
      ).toEqual({
        status: "forbidden",
      });
      expect(await createCollection(asActor(curA), { title: "", region: "x" }, deps)).toEqual({
        status: "invalid",
        errors: ["title", "region"],
      });
      limiterAllows = false;
      expect(await createCollection(asActor(curA), body, deps)).toEqual({
        status: "rate_limited",
        retryAfterSeconds: 42,
      });
    });

    it("needs an organization id when the actor belongs to several organizations", async () => {
      // curB is a member of B and S.
      expect(
        await createCollection(asActor(curB), { title: "T", region: "pomorskie" }, deps),
      ).toEqual({ status: "invalid", errors: ["organizationId"] });
      expect(
        await createCollection(
          asActor(curB),
          { title: "T", region: "pomorskie", organizationId: orgB },
          deps,
        ),
      ).toMatchObject({ status: "ok", value: { organizationId: orgB } });
    });

    it("gives 409 to the second save of the same version", async () => {
      const created = await createCollection(
        asActor(curA),
        { title: "Wersje", region: "opolskie" },
        deps,
      );

      if (created.status !== "ok") throw new Error("setup");
      const id = created.value.id;

      expect(
        await updateCollection(asActor(curA), id, { title: "Pierwsza", version: 1 }, deps),
      ).toMatchObject({
        status: "ok",
        value: { title: "Pierwsza", version: 2 },
      });
      expect(
        await updateCollection(asActor(curA2), id, { title: "Druga", version: 1 }, deps),
      ).toEqual({
        status: "conflict",
        reason: "stale_version",
      });
      expect(await updateCollection(asActor(curA2), id, { title: "Druga" }, deps)).toEqual({
        status: "invalid",
        errors: ["version"],
      });
      expect(
        await updateCollection(asActor(curA2), id, { region: "nie ma", version: 2 }, deps),
      ).toEqual({ status: "invalid", errors: ["region"] });
    });

    it("answers 404 for a collection of another organization or a missing one, and for a place likewise", async () => {
      const created = await createCollection(
        asActor(curA),
        { title: "Cudza", region: "lubuskie" },
        deps,
      );

      if (created.status !== "ok") throw new Error("setup");
      const id = created.value.id;

      for (const result of [
        await updateCollection(asActor(curB), id, { title: "x", version: 1 }, deps),
        await publishCollection(asActor(curB), id, { version: 1 }, deps),
        await unpublishCollection(asActor(curB), id, { version: 1 }, deps),
        await deleteDraftCollection(asActor(curB), id, deps),
        await addPlace(asActor(curB), id, { name: "x", latitude: 1, longitude: 1 }, deps),
        await reorderPlaces(asActor(curB), id, { placeIds: [] }, deps),
        await removePlaceFromCollection(asActor(curB), id, randomUUID(), deps),
        await updateCollection(asActor(curA), randomUUID(), { title: "x", version: 1 }, deps),
      ]) {
        expect(result).toEqual({ status: "not_found" });
      }
      expect(await rowOf(id)).toMatchObject({ title: "Cudza", version: 1 });
    });

    it("walks the whole curator path: places, order, publication, withdrawal, deletion rules", async () => {
      const created = await createCollection(
        asActor(curA),
        { title: "Ścieżka", region: "slaskie" },
        deps,
      );

      if (created.status !== "ok") throw new Error("setup");
      const id = created.value.id;

      // Publishing an empty collection is refused (422).
      expect(await publishCollection(asActor(curA), id, { version: 1 }, deps)).toEqual({
        status: "unprocessable",
        reason: "no_places",
      });

      const one = await addPlace(
        asActor(curA),
        id,
        { name: "Pierwsze", latitude: 50.1, longitude: 19.1 },
        deps,
      );
      const two = await addPlace(
        asActor(curA),
        id,
        { name: "Drugie", latitude: 50.2, longitude: 19.2, visitRadiusM: 500 },
        deps,
      );

      if (one.status !== "ok" || two.status !== "ok") throw new Error("setup");
      expect([one.value.position, two.value.position]).toEqual([1, 2]);
      expect(await addPlace(asActor(curA), id, { name: "", latitude: 1 }, deps)).toEqual({
        status: "invalid",
        errors: ["name", "longitude"],
      });
      expect(await addPlace(asActor(curA), id, { placeId: "no" }, deps)).toEqual({
        status: "invalid",
        errors: ["placeId"],
      });
      // Linking an existing place twice conflicts; a place of another organization is not found.
      expect(await addPlace(asActor(curA), id, { placeId: one.value.placeId }, deps)).toEqual({
        status: "conflict",
        reason: "already_in_collection",
      });
      const foreign = await newPlace(curB, orgB);

      expect(await addPlace(asActor(curA), id, { placeId: foreign }, deps)).toEqual({
        status: "not_found",
      });

      // Reorder: a full permutation only.
      expect(
        await reorderPlaces(asActor(curA), id, { placeIds: [one.value.placeId] }, deps),
      ).toEqual({
        status: "invalid",
        errors: ["placeIds"],
      });
      expect(
        await reorderPlaces(
          asActor(curA),
          id,
          { placeIds: [two.value.placeId, one.value.placeId] },
          deps,
        ),
      ).toMatchObject({ status: "ok" });
      expect(
        (
          await admin$<{ place_id: string }>(
            `select place_id from public.collection_places where collection_id = $1 order by position`,
            [id],
          )
        ).map((row) => row.place_id),
      ).toEqual([two.value.placeId, one.value.placeId]);

      // Place edit with a stale version.
      expect(
        await updatePlace(
          asActor(curA),
          one.value.placeId,
          { name: "Pierwsze!", version: 1 },
          deps,
        ),
      ).toMatchObject({
        status: "ok",
        value: { name: "Pierwsze!", version: 2, visitRadiusM: 200 },
      });
      expect(
        await updatePlace(asActor(curA), one.value.placeId, { name: "Stare", version: 1 }, deps),
      ).toEqual({ status: "conflict", reason: "stale_version" });
      expect(
        await updatePlace(asActor(curA), one.value.placeId, { latitude: 123, version: 2 }, deps),
      ).toEqual({ status: "invalid", errors: ["latitude"] });
      expect(
        await updatePlace(asActor(curB), one.value.placeId, { name: "x", version: 2 }, deps),
      ).toEqual({
        status: "not_found",
      });

      // Publication needs the current version.
      expect(await publishCollection(asActor(curA), id, { version: 7 }, deps)).toEqual({
        status: "conflict",
        reason: "stale_version",
      });
      expect(await unpublishCollection(asActor(curA), id, { version: 1 }, deps)).toEqual({
        status: "unprocessable",
        reason: "not_published",
      });
      const published = await publishCollection(asActor(curA), id, { version: 1 }, deps);

      expect(published).toMatchObject({ status: "ok", value: { status: "published", version: 2 } });
      expect(await publishCollection(asActor(curA), id, { version: 2 }, deps)).toEqual({
        status: "unprocessable",
        reason: "already_published",
      });

      // The guest sees it, with the places in the new order.
      const slugValue = (published as { value: { slug: string } }).value.slug;
      const seen = await getPublishedCollection(slugValue, deps);

      expect(seen).toMatchObject({
        status: "ok",
        value: {
          title: "Ścieżka",
          organization: { name: "Gmina A", slug: "gmina-a" },
        },
      });
      expect(
        (seen as unknown as { value: { places: { name: string }[] } }).value.places.map(
          (place) => place.name,
        ),
      ).toEqual(["Drugie", "Pierwsze!"]);
      expect(await getPublishedPlace(one.value.placeId, deps)).toMatchObject({
        status: "ok",
        value: { name: "Pierwsze!", collections: [{ slug: slugValue, title: "Ścieżka" }] },
      });

      // Withdrawn: public reads give the same not_found as for a missing one.
      expect(await unpublishCollection(asActor(curA), id, { version: 2 }, deps)).toMatchObject({
        status: "ok",
        value: { status: "draft", version: 3 },
      });
      expect(await getPublishedCollection(slugValue, deps)).toEqual({ status: "not_found" });
      expect(await getPublishedPlace(one.value.placeId, deps)).toEqual({ status: "not_found" });
      expect(await getPublishedCollection("nie-ma-takiej-aaaaaa", deps)).toEqual({
        status: "not_found",
      });
      expect(await getPublishedCollection("Zły Slug", deps)).toEqual({ status: "not_found" });
      expect(await getPublishedPlace("not-a-uuid", deps)).toEqual({ status: "not_found" });

      // Removing a link keeps the place; once published, the collection cannot be deleted (409).
      expect(await removePlaceFromCollection(asActor(curA), id, two.value.placeId, deps)).toEqual({
        status: "ok",
        value: null,
      });
      expect(await removePlaceFromCollection(asActor(curA), id, two.value.placeId, deps)).toEqual({
        status: "not_found",
      });
      expect(
        await admin$(`select 1 from public.places where id = $1`, [two.value.placeId]),
      ).toHaveLength(1);
      expect(await deleteDraftCollection(asActor(curA), id, deps)).toEqual({
        status: "conflict",
        reason: "was_published",
      });
      expect(await admin$(`select 1 from public.collections where id = $1`, [id])).toHaveLength(1);

      // A draft never published can be deleted.
      const fresh = await createCollection(
        asActor(curA),
        { title: "Świeża", region: "slaskie" },
        deps,
      );

      if (fresh.status !== "ok") throw new Error("setup");
      expect(await deleteDraftCollection(asActor(curA), fresh.value.id, deps)).toEqual({
        status: "ok",
        value: null,
      });
    });

    it("keeps the last place of a published collection and answers a NUL character with invalid input", async () => {
      const created = await createCollection(
        asActor(curA),
        { title: "Z jednym miejscem", region: "slaskie" },
        deps,
      );

      if (created.status !== "ok") throw new Error("setup");
      const { id } = created.value;
      const added = await addPlace(
        asActor(curA),
        id,
        { name: "Jedyne", latitude: 50, longitude: 19 },
        deps,
      );

      if (added.status !== "ok") throw new Error("setup");
      expect(
        await publishCollection(asActor(curA), id, { version: created.value.version }, deps),
      ).toMatchObject({ status: "ok" });

      expect(await removePlaceFromCollection(asActor(curA), id, added.value.placeId, deps)).toEqual(
        { status: "conflict", reason: "last_place_of_published_collection" },
      );
      expect(
        await admin$(`select 1 from public.collection_places where collection_id = $1`, [id]),
      ).toHaveLength(1);

      // A second place makes the first removable; the last one stays again.
      const second = await addPlace(
        asActor(curA),
        id,
        { name: "Drugie", latitude: 50.1, longitude: 19.1 },
        deps,
      );

      if (second.status !== "ok") throw new Error("setup");
      expect(
        await removePlaceFromCollection(asActor(curA), id, added.value.placeId, deps),
      ).toMatchObject({ status: "ok" });
      expect(
        await removePlaceFromCollection(asActor(curA), id, second.value.placeId, deps),
      ).toEqual({ status: "conflict", reason: "last_place_of_published_collection" });

      expect(
        await createCollection(asActor(curA), { title: "a\u0000b", region: "slaskie" }, deps),
      ).toEqual({ status: "invalid", errors: ["title"] });
      expect(
        await addPlace(asActor(curA), id, { name: "a\u0000b", latitude: 1, longitude: 1 }, deps),
      ).toEqual({ status: "invalid", errors: ["name"] });
    });

    it("shows a guest the same answer for a draft and for a collection that does not exist", async () => {
      const created = await createCollection(
        asActor(curA),
        { title: "Tajny szkic", region: "slaskie" },
        deps,
      );

      if (created.status !== "ok") throw new Error("setup");

      expect(await getPublishedCollection(created.value.slug, deps)).toEqual(
        await getPublishedCollection("zupelnie-inny-slug-abc123", deps),
      );
    });

    // D-27: the address comes from the title at the first publication and
    // never changes afterwards.
    describe("collection address at the first publication (D-27)", () => {
      const publishable = async (title: string) => {
        const created = await createCollection(asActor(curA), { title, region: "slaskie" }, deps);

        if (created.status !== "ok") throw new Error("setup");
        const added = await addPlace(
          asActor(curA),
          created.value.id,
          { name: "Miejsce adresu", latitude: 50, longitude: 19 },
          deps,
        );

        if (added.status !== "ok") throw new Error("setup");

        return { id: created.value.id, slug: created.value.slug, version: created.value.version };
      };

      it("takes the address from the title at the moment of the first publication", async () => {
        const draft = await publishable("Robocza nazwa");

        expect(draft.slug).toMatch(/^robocza-nazwa-[a-z0-9]{6}$/);
        const renamed = await updateCollection(
          asActor(curA),
          draft.id,
          { title: "Zamki Pomorza", version: draft.version },
          deps,
        );

        if (renamed.status !== "ok") throw new Error("setup");
        // Renaming a draft does not touch the address.
        expect(renamed.value.slug).toBe(draft.slug);

        const published = await publishCollection(
          asActor(curA),
          draft.id,
          { version: renamed.value.version },
          deps,
        );

        expect(published.status).toBe("ok");
        if (published.status !== "ok") return;
        expect(published.value.slug).toMatch(/^zamki-pomorza-[a-z0-9]{6}$/);
        expect(await getPublishedCollection(published.value.slug, deps)).toMatchObject({
          status: "ok",
        });
        expect(await getPublishedCollection(draft.slug, deps)).toEqual({ status: "not_found" });
      });

      it("keeps the address after the title changes, the withdrawal and a new publication", async () => {
        const draft = await publishable("Pierwszy tytuł");
        const published = await publishCollection(
          asActor(curA),
          draft.id,
          { version: draft.version },
          deps,
        );

        if (published.status !== "ok") throw new Error("setup");
        const address = published.value.slug;

        const renamed = await updateCollection(
          asActor(curA),
          draft.id,
          { title: "Zupełnie inny tytuł", version: published.value.version },
          deps,
        );

        if (renamed.status !== "ok") throw new Error("setup");
        expect(renamed.value.slug).toBe(address);

        const withdrawn = await unpublishCollection(
          asActor(curA),
          draft.id,
          { version: renamed.value.version },
          deps,
        );

        if (withdrawn.status !== "ok") throw new Error("setup");
        expect(withdrawn.value.slug).toBe(address);

        const again = await publishCollection(
          asActor(curA),
          draft.id,
          { version: withdrawn.value.version },
          deps,
        );

        expect(again).toMatchObject({
          status: "ok",
          value: { slug: address, title: "Zupełnie inny tytuł" },
        });
        expect(await getPublishedCollection(address, deps)).toMatchObject({ status: "ok" });
      });

      it("draws another suffix when the address from the title is taken, even by a draft the curator cannot see", async () => {
        const draft = await publishable("Kolizja adresów");
        // A draft of another organization holds the first address that will be drawn.
        await admin$(
          `insert into public.collections (slug, organization_id, title, region)
           values ('kolizja-adresow-aaaaaa', $1, 'Cudzy szkic', 'slaskie')`,
          [orgB],
        );
        let calls = 0;
        const collidingDeps: CatalogDeps = {
          ...deps,
          // 'aaaaaa' first (taken), then 'bbbbbb'.
          random: () => (calls++ < 6 ? 0 : 1),
        };

        const published = await publishCollection(
          asActor(curA),
          draft.id,
          { version: draft.version },
          collidingDeps,
        );

        expect(published).toMatchObject({
          status: "ok",
          value: { slug: "kolizja-adresow-bbbbbb", status: "published" },
        });
      });

      it("lets the database reject any other change of the address by the application role", async () => {
        const draft = await publishable("Adres w bazie");

        // A draft that is not being published first keeps its address.
        await as(curA, `update public.collections set slug = 'podmieniony-aaaaaa' where id = ?`, [
          draft.id,
        ]);
        expect((await rowOf(draft.id)).slug).toBe(draft.slug);

        const published = await publishCollection(
          asActor(curA),
          draft.id,
          { version: draft.version },
          deps,
        );

        if (published.status !== "ok") throw new Error("setup");
        // After the first publication no statement changes it, also together with the status.
        await as(curA, `update public.collections set slug = 'podmieniony-bbbbbb' where id = ?`, [
          draft.id,
        ]);
        await as(
          curA,
          `update public.collections set status = 'draft', slug = 'podmieniony-cccccc' where id = ?`,
          [draft.id],
        );
        await as(
          curA,
          `update public.collections set status = 'published', slug = 'podmieniony-dddddd' where id = ?`,
          [draft.id],
        );
        expect((await rowOf(draft.id)).slug).toBe(published.value.slug);
      });
    });
  });
});

// The curator routes through the real route modules: the session and the
// database come from the test, everything else is the shipped code.
const routeState = vi.hoisted(() => ({
  session: null as { id: string; role: "user" | "admin" } | null,
  allow: true,
  app: null as unknown as import("@mikro-orm/postgresql").MikroORM,
}));

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: async () => routeState.session }),
  getActionRateLimiter: () => ({ reserve: async () => ({ allowed: true }) }),
}));
vi.mock("@/features/catalog/infrastructure/catalog-deps", () => ({
  getCatalogDeps: () => ({
    withUserContext: (actor: { id: string }, work: never) =>
      runInUserContext(routeState.app.em, actor, work),
    withGuestContext: (work: never) => runInGuestContext(routeState.app.em, work),
    limiter: {
      reserve: async () =>
        routeState.allow ? { allowed: true } : { allowed: false, retryAfterSeconds: 7 },
    },
    repository: postgresCatalogRepository,
    random: (max: number) => randomInt(max),
  }),
}));

describe("curator routes", () => {
  let routeDb: ScratchDatabase;
  // The route modules, loaded after the mocks are in place.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const route = {} as Record<string, Record<string, any>>;

  const routeUsers = {
    a: user("route-a"),
    b: user("route-b"),
    plain: user("route-plain"),
    admin: user("route-admin"),
  };
  let routeOrgA = "";

  const request = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

  beforeAll(async () => {
    routeDb = await createScratchDatabase("krajozbior_integration_catalog_routes");
    await routeDb.migrate();
    for (const { id, email } of Object.values(routeUsers)) {
      await withClient(routeDb.adminUrl, (client) =>
        client.query(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
          id,
          email.split("@")[0],
          email,
        ]),
      );
    }
    routeOrgA = await withClient(routeDb.adminUrl, async (client) => {
      const org = await client.query(
        `insert into public.organizations (name, slug, kind) values ('Gmina R', 'gmina-r', 'municipality') returning id`,
      );
      await client.query(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [org.rows[0].id, routeUsers.a.id],
      );
      const orgB = await client.query(
        `insert into public.organizations (name, slug, kind) values ('Gmina Q', 'gmina-q', 'municipality') returning id`,
      );
      await client.query(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [orgB.rows[0].id, routeUsers.b.id],
      );

      return org.rows[0].id as string;
    });
    routeState.app = await MikroORM.init({
      ...createOrmConfig(routeDb.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });

    route.collections = await import("@/app/api/curator/collections/route");
    route.collection = await import("@/app/api/curator/collections/[collectionId]/route");
    route.publish = await import("@/app/api/curator/collections/[collectionId]/publish/route");
    route.unpublish = await import("@/app/api/curator/collections/[collectionId]/unpublish/route");
    route.places = await import("@/app/api/curator/collections/[collectionId]/places/route");
    route.order = await import("@/app/api/curator/collections/[collectionId]/places/order/route");
    route.link =
      await import("@/app/api/curator/collections/[collectionId]/places/[placeId]/route");
    route.place = await import("@/app/api/curator/places/[placeId]/route");
  }, 60_000);

  beforeEach(() => {
    routeState.session = null;
    routeState.allow = true;
  });

  afterAll(async () => {
    await routeState.app?.close(true);
    await routeDb?.drop();
  });

  const post = (body: unknown, headers?: Record<string, string>) =>
    route.collections.POST!(request("POST", "/api/curator/collections", body, headers));
  const makeCollection = async () => {
    routeState.session = { id: routeUsers.a.id, role: "user" };
    const response = await post({ title: "Trasa", region: "pomorskie" });

    return (await response.json()) as { id: string; version: number; slug: string };
  };

  it("answers 401 without a session and never reaches the database", async () => {
    const response = await post({ title: "T", region: "pomorskie" });

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers 403 to a signed-in account without a membership", async () => {
    routeState.session = { id: routeUsers.plain.id, role: "user" };

    expect((await post({ title: "T", region: "pomorskie" })).status).toBe(403);
  });

  it("gives an administrator without a membership no curator access: 403 on the routes, no rows in the database", async () => {
    const { id, version } = await makeCollection();
    const params = ctx({ collectionId: id });

    routeState.session = { id: routeUsers.admin.id, role: "admin" };

    expect((await post({ title: "T", region: "pomorskie" })).status).toBe(403);
    expect(
      (
        await route.collection.PATCH!(
          request("PATCH", `/api/curator/collections/${id}`, { title: "Hak", version }),
          params,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await route.publish.POST!(
          request("POST", `/api/curator/collections/${id}/publish`, { version }),
          params,
        )
      ).status,
    ).toBe(403);

    // The same account straight in the database (krajozbior_app, admin user context).
    const draftsSeen = await runInUserContext(routeState.app.em, routeUsers.admin, ({ em }) =>
      em.execute<{ id: string }[]>(`select id from public.collections where id = ?`, [id]),
    );

    expect(draftsSeen).toEqual([]);
    await expect(
      runInUserContext(routeState.app.em, routeUsers.admin, ({ em }) =>
        em.execute(
          `insert into public.collections (slug, organization_id, title, region)
           values ('admin-hak-1', ?, 'Hak', 'pomorskie')`,
          [routeOrgA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      runInUserContext(routeState.app.em, routeUsers.admin, ({ em }) =>
        em.execute(`update public.collections set title = 'Hak' where id = ? returning id`, [id]),
      ),
    ).resolves.toEqual([]);
  });

  it("refuses a request from another origin (403) and an oversized body (413)", async () => {
    routeState.session = { id: routeUsers.a.id, role: "user" };

    expect(
      (
        await post(
          { title: "T", region: "pomorskie" },
          { origin: "http://evil.example", host: "localhost" },
        )
      ).status,
    ).toBe(403);
    expect((await post({ title: "x".repeat(20_000), region: "pomorskie" })).status).toBe(413);
    expect(
      (
        await route.collections.POST!(
          new Request("http://localhost/api/curator/collections", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{ not json",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("answers 429 with Retry-After when the limit is spent", async () => {
    routeState.session = { id: routeUsers.a.id, role: "user" };
    routeState.allow = false;
    const response = await post({ title: "T", region: "pomorskie" });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
  });

  it("creates a draft (201) and answers 404 to another organization's curator on every route", async () => {
    const { id, version } = await makeCollection();
    const params = ctx({ collectionId: id });

    routeState.session = { id: routeUsers.b.id, role: "user" };

    const attempts = [
      route.collection.PATCH!(
        request("PATCH", `/api/curator/collections/${id}`, { title: "Hak", version }),
        params,
      ),
      route.collection.DELETE!(request("DELETE", `/api/curator/collections/${id}`), params),
      route.publish.POST!(
        request("POST", `/api/curator/collections/${id}/publish`, { version }),
        params,
      ),
      route.unpublish.POST!(
        request("POST", `/api/curator/collections/${id}/unpublish`, { version }),
        params,
      ),
      route.places.POST!(
        request("POST", `/api/curator/collections/${id}/places`, {
          name: "x",
          latitude: 1,
          longitude: 1,
        }),
        params,
      ),
      route.order.PUT!(
        request("PUT", `/api/curator/collections/${id}/places/order`, { placeIds: [] }),
        params,
      ),
      route.link.DELETE!(
        request("DELETE", `/api/curator/collections/${id}/places/${randomUUID()}`),
        ctx({ collectionId: id, placeId: randomUUID() }),
      ),
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(404);
    }
    expect(
      (
        await withClient(routeDb.adminUrl, (client) =>
          client.query(`select title, version from public.collections where id = $1`, [id]),
        )
      ).rows[0],
    ).toEqual({ title: "Trasa", version: 1 });
    expect(
      (
        await route.collection.PATCH!(
          request("PATCH", "/api/curator/collections/not-a-uuid", { version: 1 }),
          ctx({ collectionId: "not-a-uuid" }),
        )
      ).status,
    ).toBe(404);
  });

  it("walks the happy path over HTTP: place, publish (422 first), stale save (409), delete rules", async () => {
    const { id, version } = await makeCollection();
    const params = ctx({ collectionId: id });

    expect(
      (
        await route.publish.POST!(
          request("POST", `/api/curator/collections/${id}/publish`, { version }),
          params,
        )
      ).status,
    ).toBe(422);

    const added = await route.places.POST!(
      request("POST", `/api/curator/collections/${id}/places`, {
        name: "Wieża",
        latitude: 54.1,
        longitude: 18.7,
      }),
      params,
    );

    expect(added.status).toBe(201);
    const placeId = ((await added.json()) as { placeId: string }).placeId;

    const edited = await route.place.PATCH!(
      request("PATCH", `/api/curator/places/${placeId}`, { visitRadiusM: 300, version: 1 }),
      ctx({ placeId }),
    );

    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { visitRadiusM: number }).visitRadiusM).toBe(300);

    const published = await route.publish.POST!(
      request("POST", `/api/curator/collections/${id}/publish`, { version }),
      params,
    );

    expect(published.status).toBe(200);
    const stale = await route.collection.PATCH!(
      request("PATCH", `/api/curator/collections/${id}`, { title: "Stare", version }),
      params,
    );

    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ message: "Ktoś zmienił tę kolekcję, odśwież" });
    expect(
      (await route.collection.DELETE!(request("DELETE", `/api/curator/collections/${id}`), params))
        .status,
    ).toBe(409);
    // The last place of a published collection stays (409).
    const lastPlace = await route.link.DELETE!(
      request("DELETE", `/api/curator/collections/${id}/places/${placeId}`),
      ctx({ collectionId: id, placeId }),
    );

    expect(lastPlace.status).toBe(409);
    expect(await lastPlace.json()).toMatchObject({
      error: "conflict",
      reason: "last_place_of_published_collection",
    });

    const fresh = await post({ title: "Do usunięcia", region: "pomorskie" });
    const freshId = ((await fresh.json()) as { id: string }).id;

    expect(
      (
        await route.collection.DELETE!(
          request("DELETE", `/api/curator/collections/${freshId}`),
          ctx({ collectionId: freshId }),
        )
      ).status,
    ).toBe(204);
    expect(routeOrgA).not.toBe("");
  });
});
