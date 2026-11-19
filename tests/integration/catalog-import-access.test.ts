import { randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// Loading an approved collection file, the database part (PR-A1):
// `catalog_import_keys` and the narrow `places_delete` policy, on the real
// database as krajozbior_app (docs/data-isolation.md, section 5). `app` is a
// pooled connection with one connection, so a leaked context would show. The
// superuser connection only prepares rows that no policy lets a curator write.
const rejectedByPolicy = /row-level security/;
const noPermission = /permission denied/;

let db: ScratchDatabase;
let app: MikroORM;

const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.com` });
const curA = user("cur-a");
const curA2 = user("cur-a2");
const curB = user("cur-b");
const curS = user("cur-s");
const explorer = user("explorer");
const outsider = user("outsider");
const actors = { curA, curA2, curB, curS, explorer, outsider };

let orgA = "";
let orgB = "";
let orgS = ""; // suspended in beforeAll, after its place exists

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

const as = (actor: { id: string }, sql: string, params: unknown[] = []) =>
  runInUserContext(app.em, actor, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));
const asGuest = (sql: string, params: unknown[] = []) =>
  runInGuestContext(app.em, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));

let counter = 0;
const key = (prefix: string) => `${prefix}:k${(counter += 1)}`;

const insertKey = (
  actor: { id: string },
  organizationId: string,
  kind: "collection" | "place" = "place",
  importKey = key(kind === "place" ? "pl" : "col"),
) =>
  as(
    actor,
    `insert into public.catalog_import_keys
       (organization_id, entity_kind, import_key, entity_id, batch_id, imported_version)
     values (?, ?, ?, ?, 'batch-1', 1) returning import_key`,
    [organizationId, kind, importKey, randomUUID()],
  );

const keysOf = (organizationId: string) =>
  admin$<{ import_key: string }>(
    `select import_key from public.catalog_import_keys where organization_id = $1`,
    [organizationId],
  );

// A place written the way the application writes it: by a curator, as krajozbior_app.
const newPlace = async (actor: { id: string }, organizationId: string): Promise<string> =>
  (
    await as(
      actor,
      `insert into public.places (organization_id, name, latitude, longitude)
       values (?, 'Miejsce', 54.1, 18.7) returning id`,
      [organizationId],
    )
  )[0]!.id as string;

const newCollection = async (actor: { id: string }, organizationId: string): Promise<string> =>
  (
    await as(
      actor,
      `insert into public.collections (slug, organization_id, title, region)
       values (?, ?, 'Kolekcja', 'pomorskie') returning id`,
      [`kolekcja-a1-${(counter += 1)}`, organizationId],
    )
  )[0]!.id as string;

const deletePlace = (actor: { id: string }, placeId: string) =>
  as(actor, `delete from public.places where id = ? returning id`, [placeId]);

const placeExists = async (placeId: string) =>
  (await admin$(`select 1 from public.places where id = $1`, [placeId])).length === 1;

describe("catalog import keys and place deletion", () => {
  let suspendedPlace = "";

  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_catalog_import");
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
    orgS = await org("Gmina S", "gmina-s", [curS]);

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });

    // A place of the organization that is suspended afterwards: its member
    // keeps neither the right to read nor to delete it.
    suspendedPlace = await newPlace(curS, orgS);
    await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgS]);
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("has row security enabled, forced and policies on the table, and a safe app role", async () => {
    const gaps = await withClient(db.adminUrl, async (client) => [
      ...(await findRowLevelSecurityGaps(client, ["public.catalog_import_keys"])),
      ...(await findApplicationRoleGaps(client)),
    ]);

    expect(gaps).toEqual([]);
  });

  it("gives krajozbior_app exactly the intended privileges and no other role any", async () => {
    const [p] = await admin$<Record<string, boolean>>(
      `select
         has_table_privilege('krajozbior_app', 'catalog_import_keys', 'select') as k_select,
         has_table_privilege('krajozbior_app', 'catalog_import_keys', 'delete') as k_delete,
         has_table_privilege('krajozbior_app', 'catalog_import_keys', 'insert, update, truncate, references, trigger') as k_table_write,
         has_column_privilege('krajozbior_app', 'catalog_import_keys', 'organization_id', 'insert') as k_org_insert,
         has_column_privilege('krajozbior_app', 'catalog_import_keys', 'imported_places', 'insert, update') as k_places,
         has_column_privilege('krajozbior_app', 'catalog_import_keys', 'imported_at', 'insert') as k_at_insert,
         has_column_privilege('krajozbior_app', 'catalog_import_keys', 'imported_at', 'update') as k_at_update,
         has_column_privilege('krajozbior_app', 'catalog_import_keys', 'organization_id', 'update') as k_org_update,
         has_column_privilege('krajozbior_app', 'catalog_import_keys', 'entity_kind', 'update') as k_kind_update,
         has_column_privilege('krajozbior_app', 'catalog_import_keys', 'import_key', 'update') as k_key_update,
         has_table_privilege('krajozbior_app', 'places', 'delete') as p_delete,
         has_table_privilege('krajozbior_app', 'places', 'truncate, references, trigger') as p_bad,
         has_any_column_privilege('krajozbior_auth', 'catalog_import_keys', 'select, insert, update') as auth_k,
         has_any_column_privilege('krajozbior_ops', 'catalog_import_keys', 'select, insert, update') as ops_k,
         has_table_privilege('krajozbior_ops', 'places', 'delete') as ops_p_delete,
         has_table_privilege('krajozbior_auth', 'places', 'delete') as auth_p_delete`,
    );

    expect(p).toEqual({
      k_select: true,
      k_delete: true,
      k_table_write: false,
      k_org_insert: true,
      k_places: true,
      k_at_insert: false,
      k_at_update: true,
      k_org_update: false,
      k_kind_update: false,
      k_key_update: false,
      p_delete: true,
      p_bad: false,
      auth_k: false,
      ops_k: false,
      ops_p_delete: false,
      auth_p_delete: false,
    });
  });

  it("shows nothing and accepts no write without a user context", async () => {
    await insertKey(curA, orgA);

    expect(await asGuest(`select * from public.catalog_import_keys`)).toEqual([]);
    // Outside any transaction helper there is no actor either.
    expect(await app.em.execute(`select * from public.catalog_import_keys`)).toEqual([]);
    await expect(
      app.em.execute(
        `insert into public.catalog_import_keys
           (organization_id, entity_kind, import_key, entity_id, batch_id, imported_version)
         values (?, 'place', 'pl:nocontext', ?, 'b', 1)`,
        [orgA, randomUUID()],
      ),
    ).rejects.toThrow(rejectedByPolicy);
    await expect(
      asGuest(
        `insert into public.catalog_import_keys
           (organization_id, entity_kind, import_key, entity_id, batch_id, imported_version)
         values (?, 'place', 'pl:guest', ?, 'b', 1)`,
        [orgA, randomUUID()],
      ),
    ).rejects.toThrow(/read-only/);
    expect(await app.em.execute(`delete from public.catalog_import_keys returning 1`)).toEqual([]);
    expect((await keysOf(orgA)).length).toBeGreaterThan(0);
  });

  it("lets the members of the organization read the keys and a full_edit member write them", async () => {
    const importKey = key("pl");

    await insertKey(curA, orgA, "place", importKey);

    // Another member of the same organization reads it and may move it on.
    expect(
      (
        await as(curA2, `select import_key from public.catalog_import_keys where import_key = ?`, [
          importKey,
        ])
      ).map((row) => row.import_key),
    ).toEqual([importKey]);
    expect(
      await as(
        curA2,
        `update public.catalog_import_keys
            set imported_version = 2, batch_id = 'batch-2', imported_at = now()
          where import_key = ? returning imported_version`,
        [importKey],
      ),
    ).toEqual([{ imported_version: 2 }]);
    expect(
      await as(curA, `delete from public.catalog_import_keys where import_key = ? returning 1`, [
        importKey,
      ]),
    ).toHaveLength(1);
  });

  it("keeps the shape of a key: the composition only for a collection, no foreign or odd key", async () => {
    // imported_places belongs to a collection key only (23514).
    await expect(
      as(
        curA,
        `insert into public.catalog_import_keys
           (organization_id, entity_kind, import_key, entity_id, batch_id, imported_version, imported_places)
         values (?, 'place', ?, ?, 'b', 1, array[?]::uuid[])`,
        [orgA, key("pl"), randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/catalog_import_keys_places_check/);
    expect(
      await as(
        curA,
        `insert into public.catalog_import_keys
           (organization_id, entity_kind, import_key, entity_id, batch_id, imported_version, imported_places)
         values (?, 'collection', ?, ?, 'b', 1, array[?]::uuid[]) returning import_key`,
        [orgA, key("col"), randomUUID(), randomUUID()],
      ),
    ).toHaveLength(1);
    await expect(
      as(
        curA,
        `insert into public.catalog_import_keys
           (organization_id, entity_kind, import_key, entity_id, batch_id, imported_version)
         values (?, 'place', 'Zly klucz ze spacja', ?, 'b', 1)`,
        [orgA, randomUUID()],
      ),
    ).rejects.toThrow(/import_key_check/);
    // One key per organization and kind; one entity per kind.
    const importKey = key("pl");
    const entityId = randomUUID();

    await as(
      curA,
      `insert into public.catalog_import_keys
         (organization_id, entity_kind, import_key, entity_id, batch_id, imported_version)
       values (?, 'place', ?, ?, 'b', 1)`,
      [orgA, importKey, entityId],
    );
    await expect(
      as(
        curA,
        `insert into public.catalog_import_keys
           (organization_id, entity_kind, import_key, entity_id, batch_id, imported_version)
         values (?, 'place', ?, ?, 'b', 1)`,
        [orgA, key("pl"), entityId],
      ),
    ).rejects.toThrow(/duplicate key/);
    // The identity of a key cannot be changed afterwards.
    await expect(
      as(
        curA,
        `update public.catalog_import_keys set import_key = 'pl:inny' where import_key = ?`,
        [importKey],
      ),
    ).rejects.toThrow(noPermission);
    await expect(
      as(curA, `update public.catalog_import_keys set organization_id = ? where import_key = ?`, [
        orgB,
        importKey,
      ]),
    ).rejects.toThrow(noPermission);
  });

  it("keeps the uniqueness of an entity within the organization: another organization may reuse the id", async () => {
    const entityId = randomUUID();
    const insertWith = (actor: { id: string }, organizationId: string) =>
      as(
        actor,
        `insert into public.catalog_import_keys
           (organization_id, entity_kind, import_key, entity_id, batch_id, imported_version)
         values (?, 'place', ?, ?, 'b', 1) returning import_key`,
        [organizationId, key("pl"), entityId],
      );

    expect(await insertWith(curA, orgA)).toHaveLength(1);
    // Another organization is not told that the id is taken elsewhere.
    expect(await insertWith(curB, orgB)).toHaveLength(1);
    await expect(insertWith(curA, orgA)).rejects.toThrow(/duplicate key/);
  });

  it("does not let a curator of another organization read, change or delete the keys, even with raw SQL", async () => {
    const importKey = key("pl");

    await insertKey(curA, orgA, "place", importKey);
    await insertKey(curB, orgB, "place", key("pl"));

    expect(
      await as(curB, `select * from public.catalog_import_keys where import_key = ?`, [importKey]),
    ).toEqual([]);
    expect(
      (await as(curB, `select organization_id from public.catalog_import_keys`)).every(
        (row) => row.organization_id === orgB,
      ),
    ).toBe(true);
    expect(
      await as(
        curB,
        `update public.catalog_import_keys set imported_version = 9 where import_key = ? returning 1`,
        [importKey],
      ),
    ).toEqual([]);
    expect(
      await as(curB, `delete from public.catalog_import_keys where import_key = ? returning 1`, [
        importKey,
      ]),
    ).toEqual([]);
    await expect(insertKey(curB, orgA)).rejects.toThrow(rejectedByPolicy);
    // Nothing of organization A changed.
    const [row] = await admin$<{ imported_version: number }>(
      `select imported_version from public.catalog_import_keys where import_key = $1`,
      [importKey],
    );

    expect(row).toEqual({ imported_version: 1 });
  });

  it("shows no key to a guest, an explorer or an account without membership, and accepts no write from them", async () => {
    await insertKey(curA, orgA);

    expect(await asGuest(`select * from public.catalog_import_keys`)).toEqual([]);
    for (const actor of [explorer, outsider]) {
      expect(await as(actor, `select * from public.catalog_import_keys`)).toEqual([]);
      await expect(insertKey(actor, orgA)).rejects.toThrow(rejectedByPolicy);
      expect(await as(actor, `delete from public.catalog_import_keys returning 1`)).toEqual([]);
      expect(
        await as(actor, `update public.catalog_import_keys set imported_version = 7 returning 1`),
      ).toEqual([]);
    }
  });

  it("gives a member of a suspended organization neither the keys nor a write", async () => {
    // The keys were written by the operator's side before the suspension.
    await admin$(
      `insert into public.catalog_import_keys
         (organization_id, entity_kind, import_key, entity_id, batch_id, imported_version)
       values ($1, 'place', 'pl:suspended', $2, 'b', 1)`,
      [orgS, randomUUID()],
    );

    expect(await as(curS, `select * from public.catalog_import_keys`)).toEqual([]);
    await expect(insertKey(curS, orgS)).rejects.toThrow(rejectedByPolicy);
    expect(await as(curS, `delete from public.catalog_import_keys returning 1`)).toEqual([]);
    expect(await keysOf(orgS)).toHaveLength(1);
  });

  it("does not leak the actor to the next transaction on the same connection", async () => {
    await insertKey(curA, orgA);
    expect((await as(curA, `select 1 from public.catalog_import_keys limit 1`)).length).toBe(1);
    expect(await asGuest(`select 1 from public.catalog_import_keys`)).toEqual([]);
    expect(await app.em.execute(`select 1 from public.catalog_import_keys`)).toEqual([]);
  });

  describe("places_delete", () => {
    it("deletes a free place of the own organization", async () => {
      const placeId = await newPlace(curA, orgA);

      expect(await deletePlace(curA, placeId)).toHaveLength(1);
      expect(await placeExists(placeId)).toBe(false);
    });

    it("deletes nothing for a curator of another organization", async () => {
      const placeId = await newPlace(curA, orgA);

      expect(await deletePlace(curB, placeId)).toEqual([]);
      expect(await placeExists(placeId)).toBe(true);
    });

    it("deletes nothing for a guest, an explorer and an account without membership", async () => {
      const placeId = await newPlace(curA, orgA);

      expect(await asGuest(`select 1 from public.places`)).toEqual([]);
      await expect(asGuest(`delete from public.places where id = ?`, [placeId])).rejects.toThrow(
        /read-only/,
      );
      expect(await deletePlace(explorer, placeId)).toEqual([]);
      expect(await deletePlace(outsider, placeId)).toEqual([]);
      expect(await placeExists(placeId)).toBe(true);
    });

    it("deletes nothing for a member of a suspended organization", async () => {
      expect(await deletePlace(curS, suspendedPlace)).toEqual([]);
      expect(await placeExists(suspendedPlace)).toBe(true);
    });

    it("keeps a place that belongs to a collection, draft or published", async () => {
      const collectionId = await newCollection(curA, orgA);
      const placeId = await newPlace(curA, orgA);

      await as(
        curA,
        `insert into public.collection_places (collection_id, place_id, organization_id, position)
         values (?, ?, ?, 1)`,
        [collectionId, placeId, orgA],
      );
      expect(await deletePlace(curA, placeId)).toEqual([]);

      await as(curA, `update public.collections set status = 'published' where id = ?`, [
        collectionId,
      ]);
      expect(await deletePlace(curA, placeId)).toEqual([]);
      expect(await placeExists(placeId)).toBe(true);

      // Once the link is gone the place is free again.
      await as(curA, `update public.collections set status = 'draft' where id = ?`, [collectionId]);
      await as(curA, `delete from public.collection_places where collection_id = ?`, [
        collectionId,
      ]);
      expect(await deletePlace(curA, placeId)).toHaveLength(1);
    });

    it("keeps a place with a visit or on a want-to-see list (23503), also outside every collection", async () => {
      // The curator cannot see these rows (PRIV); the foreign key still protects the place.
      const visited = await newPlace(curA, orgA);
      const wanted = await newPlace(curA, orgA);

      await admin$(
        `insert into public.visits (user_id, place_id, kind, date_precision)
         values ($1, $2, 'past', 'unknown')`,
        [explorer.id, visited],
      );
      await admin$(`insert into public.want_to_see_places (user_id, place_id) values ($1, $2)`, [
        explorer.id,
        wanted,
      ]);

      await expect(deletePlace(curA, visited)).rejects.toMatchObject({ code: "23503" });
      await expect(deletePlace(curA, wanted)).rejects.toMatchObject({ code: "23503" });
      expect(await placeExists(visited)).toBe(true);
      expect(await placeExists(wanted)).toBe(true);
    });
  });
});
