import { randomInt, randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import {
  getCuratorCollection,
  getCuratorPlace,
  listCuratorCollections,
} from "@/features/catalog/application/curator-queries";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";

import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// E1, PR3: the reads of the curator panel on the real database, as
// krajozbior_app (one pooled connection). Organization A against B: curator B
// gets "not found" for everything of A, exactly as for an id that does not
// exist (nothing says a foreign draft exists).
let db: ScratchDatabase;
let app: MikroORM;

const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.com` });
const curA = user("cur-a");
const curB = user("cur-b");
const explorer = user("explorer");
const asActor = (actor: { id: string }) => ({ id: actor.id, role: "user" as const });

const deps: CatalogDeps = {
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  withGuestContext: (work) => runInGuestContext(app.em, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresCatalogRepository,
  random: (max) => randomInt(max),
};

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

let orgA = "";
let orgB = "";
let draftA = "";
let publishedA = "";
let draftB = "";
const placesA: string[] = [];
let spareA = "";

describe("reads of the curator panel", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_curator_reads");
    await db.migrate();

    for (const { id, email } of [curA, curB, explorer]) {
      await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
        id,
        email.split("@")[0],
        email,
      ]);
    }

    const org = async (name: string, slug: string, member: { id: string }) => {
      const [{ id }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ($1, $2, 'municipality') returning id`,
        [name, slug],
      );

      await admin$(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [id, member.id],
      );

      return id;
    };

    orgA = await org("Gmina A", "gmina-a", curA);
    orgB = await org("Gmina B", "gmina-b", curB);

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });

    const as = (actor: { id: string }, sql: string, params: unknown[] = []) =>
      runInUserContext(app.em, actor, ({ em }) => em.execute<{ id: string }[]>(sql, params));
    const collection = async (actor: { id: string }, organizationId: string, title: string) =>
      (
        await as(
          actor,
          `insert into public.collections (slug, organization_id, title, region)
           values (?, ?, ?, 'pomorskie') returning id`,
          [`k-${randomUUID().slice(0, 8)}`, organizationId, title],
        )
      )[0]!.id;
    const place = async (actor: { id: string }, organizationId: string, name: string) =>
      (
        await as(
          actor,
          `insert into public.places (organization_id, name, address, latitude, longitude)
           values (?, ?, 'Tczew', 54.1, 18.7) returning id`,
          [organizationId, name],
        )
      )[0]!.id;

    draftA = await collection(curA, orgA, "Szkic A");
    publishedA = await collection(curA, orgA, "Opublikowana A");
    draftB = await collection(curB, orgB, "Szkic B");

    for (const [index, name] of ["Pierwsze", "Drugie", "Trzecie"].entries()) {
      const placeId = await place(curA, orgA, name);

      placesA.push(placeId);
      await as(
        curA,
        `insert into public.collection_places (collection_id, place_id, organization_id, position)
         values (?, ?, ?, ?)`,
        [draftA, placeId, orgA, index + 1],
      );
    }

    // One place of the organization that is in no collection, and one in the published one.
    spareA = await place(curA, orgA, "Wolne");
    await as(
      curA,
      `insert into public.collection_places (collection_id, place_id, organization_id, position)
       values (?, ?, ?, 1)`,
      [publishedA, placesA[0], orgA],
    );
    await as(curA, `update public.collections set status = 'published' where id = ?`, [publishedA]);
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("lists the collections of the own organization, drafts included, with place counts", async () => {
    const result = await listCuratorCollections(asActor(curA), orgA, deps);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.value.map((row) => [row.title, row.status, row.placeCount]).sort()).toEqual([
      ["Opublikowana A", "published", 1],
      ["Szkic A", "draft", 3],
    ]);
    expect(result.value[0]?.updatedAt).toBeInstanceOf(Date);
  });

  it("answers not found to curator B for the organization and every collection of A", async () => {
    expect(await listCuratorCollections(asActor(curB), orgA, deps)).toEqual({
      status: "not_found",
    });

    const foreign = await getCuratorCollection(asActor(curB), draftA, deps);
    const missing = await getCuratorCollection(asActor(curB), randomUUID(), deps);
    const malformed = await getCuratorCollection(asActor(curB), "nie-uuid", deps);

    expect(foreign).toEqual({ status: "not_found" });
    expect(foreign).toEqual(missing);
    expect(foreign).toEqual(malformed);
    expect(await getCuratorCollection(asActor(curB), publishedA, deps)).toEqual({
      status: "not_found",
    });
  });

  it("does not show the draft of B to curator A either", async () => {
    expect(await getCuratorCollection(asActor(curA), draftB, deps)).toEqual({
      status: "not_found",
    });
    expect(await listCuratorCollections(asActor(curA), orgB, deps)).toEqual({
      status: "not_found",
    });
  });

  it("answers unauthenticated to a guest and forbidden to an account without membership", async () => {
    expect(await listCuratorCollections(null, orgA, deps)).toEqual({ status: "unauthenticated" });
    expect(await getCuratorCollection(null, draftA, deps)).toEqual({ status: "unauthenticated" });
    expect(await listCuratorCollections(asActor(explorer), orgA, deps)).toEqual({
      status: "forbidden",
    });
    expect(await getCuratorCollection(asActor(explorer), draftA, deps)).toEqual({
      status: "forbidden",
    });
  });

  it("returns the editor data: places in order and the places not yet in the collection", async () => {
    const result = await getCuratorCollection(asActor(curA), draftA, deps);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.value.collection).toMatchObject({ id: draftA, status: "draft", version: 1 });
    expect(result.value.places.map((item) => [item.name, item.position])).toEqual([
      ["Pierwsze", 1],
      ["Drugie", 2],
      ["Trzecie", 3],
    ]);
    expect(result.value.places[0]).toMatchObject({
      latitude: 54.1,
      visitRadiusM: 200,
      organizationId: orgA,
    });
    expect(result.value.otherPlaces).toEqual([{ id: spareA, name: "Wolne", address: "Tczew" }]);
  });

  it("finds a place only inside its own collection and only for its organization", async () => {
    const found = await getCuratorPlace(asActor(curA), draftA, placesA[1]!, deps);

    expect(found).toMatchObject({
      status: "ok",
      value: { place: { name: "Drugie", position: 2 } },
    });
    // The place exists, but is not in this collection.
    expect(await getCuratorPlace(asActor(curA), draftA, spareA, deps)).toEqual({
      status: "not_found",
    });
    expect(await getCuratorPlace(asActor(curB), draftA, placesA[1]!, deps)).toEqual({
      status: "not_found",
    });
  });

  it("takes the reads away when the organization is suspended", async () => {
    await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgA]);

    try {
      expect(await listCuratorCollections(asActor(curA), orgA, deps)).toEqual({
        status: "forbidden",
      });
      expect(await getCuratorCollection(asActor(curA), draftA, deps)).toEqual({
        status: "forbidden",
      });
    } finally {
      await admin$(`update public.organizations set status = 'approved' where id = $1`, [orgA]);
    }
  });
});
