import { randomInt, randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import {
  getPublishedCollection,
  getPublishedPlace,
} from "@/features/catalog/application/public-catalog";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// E1, PR4: what a guest reads on /collections/[slug] and /places/[placeId].
// The use cases run in the guest context on a pool of one connection as
// krajozbior_app, so a context leaked from a curator transaction would show.
// Every case where the content is not public must give the same `not_found`
// as an address that never existed.
let db: ScratchDatabase;
let app: MikroORM;

const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.com` });
const curA = user("cur-a");
const curB = user("cur-b");

let orgA = "";
let orgB = "";

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);
const as = (actor: { id: string }, sql: string, params: unknown[] = []) =>
  runInUserContext(app.em, actor, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));

const deps: CatalogDeps = {
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  withGuestContext: (work) => runInGuestContext(app.em, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresCatalogRepository,
  random: (max) => randomInt(max),
};

let counter = 0;

const newCollection = async (actor: { id: string }, organizationId: string, title: string) => {
  const slug = `publiczna-${(counter += 1)}`;
  const id = (
    await as(
      actor,
      `insert into public.collections (slug, organization_id, title, summary, region)
       values (?, ?, ?, 'Opis kolekcji', 'pomorskie') returning id`,
      [slug, organizationId, title],
    )
  )[0]!.id as string;

  return { id, slug };
};

const newPlace = async (actor: { id: string }, organizationId: string, name: string) =>
  (
    await as(
      actor,
      `insert into public.places (organization_id, name, description, address, access_info, latitude, longitude)
       values (?, ?, 'Opis miejsca', 'Tczew', 'Wejście od rynku', 54.0928, 18.7919) returning id`,
      [organizationId, name],
    )
  )[0]!.id as string;

const link = (
  actor: { id: string },
  collectionId: string,
  placeId: string,
  organizationId: string,
  position: number,
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

const unpublish = (actor: { id: string }, collectionId: string) =>
  as(actor, `update public.collections set status = 'draft' where id = ? returning id`, [
    collectionId,
  ]);

const missingSlug = "nie-ma-takiej-kolekcji-aaaaaa";
const missingId = "11111111-1111-4111-8111-111111111111";

describe("public read of collections and places (guest context)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_public_read");
    await db.migrate();

    for (const { id, email } of [curA, curB]) {
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
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("gives a guest only the public fields of a published collection and its places in order", async () => {
    const collection = await newCollection(curA, orgA, "Publiczna");
    const second = await newPlace(curA, orgA, "Drugie");
    const first = await newPlace(curA, orgA, "Pierwsze");

    await link(curA, collection.id, second, orgA, 2);
    await link(curA, collection.id, first, orgA, 1);
    await publish(curA, collection.id);

    const result = await getPublishedCollection(collection.slug, deps);

    expect(result).toEqual({
      status: "ok",
      value: {
        id: collection.id,
        slug: collection.slug,
        title: "Publiczna",
        summary: "Opis kolekcji",
        region: "pomorskie",
        organization: { name: "Gmina A", slug: "gmina-a" },
        places: [
          { id: first, name: "Pierwsze", address: "Tczew", position: 1 },
          { id: second, name: "Drugie", address: "Tczew", position: 2 },
        ],
      },
    });

    const place = await getPublishedPlace(first, deps);

    expect(place).toEqual({
      status: "ok",
      value: {
        id: first,
        name: "Pierwsze",
        description: "Opis miejsca",
        address: "Tczew",
        accessInfo: "Wejście od rynku",
        latitude: 54.0928,
        longitude: 18.7919,
        visitRadiusM: 200,
        organization: { name: "Gmina A", slug: "gmina-a" },
        collections: [{ slug: collection.slug, title: "Publiczna" }],
      },
    });
  });

  it("answers a draft, a draft's place and a missing address with the same not_found", async () => {
    const draft = await newCollection(curA, orgA, "Tajny szkic");
    const place = await newPlace(curA, orgA, "Miejsce ze szkicu");

    await link(curA, draft.id, place, orgA, 1);

    expect(await getPublishedCollection(draft.slug, deps)).toEqual({ status: "not_found" });
    expect(await getPublishedCollection(draft.slug, deps)).toEqual(
      await getPublishedCollection(missingSlug, deps),
    );
    expect(await getPublishedPlace(place, deps)).toEqual({ status: "not_found" });
    expect(await getPublishedPlace(place, deps)).toEqual(await getPublishedPlace(missingId, deps));

    // A place that is in no collection at all is not public either.
    const loose = await newPlace(curA, orgA, "Luźne miejsce");

    expect(await getPublishedPlace(loose, deps)).toEqual({ status: "not_found" });
  });

  it("lists only the published collections of a place that is also in a draft", async () => {
    const published = await newCollection(curA, orgA, "Opublikowana");
    const draft = await newCollection(curA, orgA, "Szkic z tym samym miejscem");
    const place = await newPlace(curA, orgA, "Wspólne");

    await link(curA, published.id, place, orgA, 1);
    await link(curA, draft.id, place, orgA, 1);
    await publish(curA, published.id);

    const result = await getPublishedPlace(place, deps);

    expect(result).toMatchObject({
      status: "ok",
      value: { collections: [{ slug: published.slug, title: "Opublikowana" }] },
    });
    expect(JSON.stringify(result)).not.toContain("Szkic z tym samym miejscem");
  });

  it("hides a withdrawn collection and shows it again after it is published once more", async () => {
    const collection = await newCollection(curA, orgA, "Wycofywana");
    const place = await newPlace(curA, orgA, "Miejsce wycofywanej");

    await link(curA, collection.id, place, orgA, 1);
    await publish(curA, collection.id);
    expect(await getPublishedCollection(collection.slug, deps)).toMatchObject({ status: "ok" });

    await unpublish(curA, collection.id);
    expect(await getPublishedCollection(collection.slug, deps)).toEqual({ status: "not_found" });
    expect(await getPublishedPlace(place, deps)).toEqual({ status: "not_found" });

    await publish(curA, collection.id);
    expect(await getPublishedCollection(collection.slug, deps)).toMatchObject({ status: "ok" });
    expect(await getPublishedPlace(place, deps)).toMatchObject({ status: "ok" });
  });

  it("hides the content of an organization that is not approved", async () => {
    const collection = await newCollection(curB, orgB, "Organizacji B");
    const place = await newPlace(curB, orgB, "Miejsce organizacji B");

    await link(curB, collection.id, place, orgB, 1);
    await publish(curB, collection.id);
    expect(await getPublishedCollection(collection.slug, deps)).toMatchObject({ status: "ok" });

    await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgB]);
    expect(await getPublishedCollection(collection.slug, deps)).toEqual({ status: "not_found" });
    expect(await getPublishedPlace(place, deps)).toEqual({ status: "not_found" });

    await admin$(`update public.organizations set status = 'approved' where id = $1`, [orgB]);
  });

  it("does not take the identity of a curator who read just before on the same connection", async () => {
    const draft = await newCollection(curA, orgA, "Szkic po kuratorze");
    const place = await newPlace(curA, orgA, "Miejsce po kuratorze");

    await link(curA, draft.id, place, orgA, 1);

    // The curator sees the own draft ...
    expect(
      await as(curA, `select id from public.collections where id = ?`, [draft.id]),
    ).toHaveLength(1);
    // ... and the very next guest read on the single connection does not.
    expect(await getPublishedCollection(draft.slug, deps)).toEqual({ status: "not_found" });
    expect(await getPublishedPlace(place, deps)).toEqual({ status: "not_found" });
  });

  it("opens only a read-only transaction for a guest", async () => {
    await expect(
      runInGuestContext(app.em, ({ em }) =>
        em.execute(
          `insert into public.collections (slug, organization_id, title, region)
           values ('zapis-goscia', ?, 'x', 'pomorskie')`,
          [orgA],
        ),
      ),
    ).rejects.toThrow(/read-only transaction/);
    expect(
      await admin$(`select 1 from public.collections where slug = 'zapis-goscia'`),
    ).toHaveLength(0);
  });

  it("rejects an address that is not a slug or a UUID without touching the database", async () => {
    expect(await getPublishedCollection("Zły Slug", deps)).toEqual({ status: "not_found" });
    expect(await getPublishedCollection("a".repeat(81), deps)).toEqual({ status: "not_found" });
    expect(await getPublishedPlace("not-a-uuid", deps)).toEqual({ status: "not_found" });
  });
});
