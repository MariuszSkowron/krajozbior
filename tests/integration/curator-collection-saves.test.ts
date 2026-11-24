import { randomInt, randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { listCuratorCollections } from "@/features/catalog/application/curator-queries";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";

import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// Paczka 4: kurator widzi liczbę zapisów swojej kolekcji i nic więcej. `saved_collections` to
// dane PRIV; jedyna droga do liczby to funkcja `app_collection_saves` (security definer), która
// odpowiada tylko członkowi zatwierdzonej organizacji. Połączenie jako krajozbior_app.
let db: ScratchDatabase;
let app: MikroORM;

const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.com` });
const curA = user("sv-cur-a");
const curB = user("sv-cur-b");
const explorer1 = user("sv-explorer-1");
const explorer2 = user("sv-explorer-2");
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

const savesAs = (actor: { id: string } | null, organizationId: string) =>
  actor === null
    ? runInGuestContext(app.em, ({ em }) =>
        em.execute<{ collection_id: string; saves: number }[]>(
          `select * from public.app_collection_saves(?)`,
          [organizationId],
        ),
      )
    : runInUserContext(app.em, actor, ({ em }) =>
        em.execute<{ collection_id: string; saves: number }[]>(
          `select * from public.app_collection_saves(?)`,
          [organizationId],
        ),
      );

let orgA = "";
let orgB = "";
let publishedA = "";
let withdrawnA = "";
let publishedB = "";

describe("the number of saves of a collection for its curator", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_collection_saves");
    await db.migrate();

    for (const { id, email } of [curA, curB, explorer1, explorer2]) {
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

    orgA = await org("Gmina A", "sv-gmina-a", curA);
    orgB = await org("Gmina B", "sv-gmina-b", curB);

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });

    const as = (actor: { id: string }, sql: string, params: unknown[] = []) =>
      runInUserContext(app.em, actor, ({ em }) => em.execute<{ id: string }[]>(sql, params));
    const collection = async (
      actor: { id: string },
      organizationId: string,
      title: string,
      publish: boolean,
    ) => {
      const [{ id }] = await as(
        actor,
        `insert into public.collections (slug, organization_id, title, region)
         values (?, ?, ?, 'pomorskie') returning id`,
        [`sv-${randomUUID().slice(0, 8)}`, organizationId, title],
      );

      if (publish) {
        const [{ id: placeId }] = await as(
          actor,
          `insert into public.places (organization_id, name, address, latitude, longitude)
           values (?, ?, 'Tczew', 54.1, 18.7) returning id`,
          [organizationId, `Miejsce ${title}`],
        );

        await as(
          actor,
          `insert into public.collection_places (collection_id, place_id, organization_id, position)
           values (?, ?, ?, 1)`,
          [id, placeId, organizationId],
        );
        await as(actor, `update public.collections set status = 'published' where id = ?`, [id]);
      }

      return id;
    };

    publishedA = await collection(curA, orgA, "Opublikowana A", true);
    withdrawnA = await collection(curA, orgA, "Wycofana A", true);
    await collection(curA, orgA, "Szkic A", false);
    publishedB = await collection(curB, orgB, "Opublikowana B", true);

    // Two explorers saved A, one saved the one that is withdrawn later, one saved B.
    for (const [who, collectionId] of [
      [explorer1, publishedA],
      [explorer2, publishedA],
      [explorer1, withdrawnA],
      [explorer1, publishedB],
    ] as const) {
      await admin$(
        `insert into public.saved_collections (user_id, collection_id) values ($1, $2)`,
        [who.id, collectionId],
      );
    }

    // Withdrawing keeps the saves (D-15): the curator still sees the number.
    await as(curA, `update public.collections set status = 'draft' where id = ?`, [withdrawnA]);
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("shows the curator only a number per collection, withdrawn ones included", async () => {
    const result = await listCuratorCollections(asActor(curA), orgA, deps);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(Object.fromEntries(result.value.map((row) => [row.title, row.saveCount]))).toEqual({
      "Opublikowana A": 2,
      "Wycofana A": 1,
      "Szkic A": 0,
    });
    expect(Object.keys(result.value[0] ?? {}).sort()).toEqual(
      ["id", "placeCount", "region", "saveCount", "status", "title", "updatedAt"].sort(),
    );
  });

  it("gives curator B the numbers of B only, and nothing for the organization of A", async () => {
    expect(await savesAs(curB, orgB)).toEqual([{ collection_id: publishedB, saves: 1 }]);
    expect(await savesAs(curB, orgA)).toEqual([]);
    expect(await listCuratorCollections(asActor(curB), orgA, deps)).toEqual({
      status: "not_found",
    });
  });

  it("gives an explorer, an account of no organization and a guest nothing", async () => {
    expect(await savesAs(explorer1, orgA)).toEqual([]);
    expect(await savesAs(explorer1, orgB)).toEqual([]);
    expect(await savesAs(null, orgA)).toEqual([]);
    expect(await listCuratorCollections(asActor(explorer1), orgA, deps)).toEqual({
      status: "forbidden",
    });
  });

  it("gives nothing for an organization that is not approved", async () => {
    await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgB]);

    try {
      expect(await savesAs(curB, orgB)).toEqual([]);
    } finally {
      await admin$(`update public.organizations set status = 'approved' where id = $1`, [orgB]);
    }
  });

  it("keeps the rows of saved_collections private: a curator reads none, not even of the own collection", async () => {
    const rows = await runInUserContext(app.em, curA, ({ em }) =>
      em.execute<{ user_id: string }[]>(`select user_id from public.saved_collections`),
    );

    expect(rows).toEqual([]);
  });

  it("lets only krajozbior_app run the function", async () => {
    const privileges = await admin$<{ role: string; allowed: boolean }>(
      `select r as role, has_function_privilege(r, 'public.app_collection_saves(uuid)', 'execute') as allowed
         from unnest(array['krajozbior_app', 'krajozbior_ops', 'krajozbior_auth']) r`,
    );

    expect(Object.fromEntries(privileges.map((row) => [row.role, row.allowed]))).toEqual({
      krajozbior_app: true,
      krajozbior_ops: false,
      krajozbior_auth: false,
    });
  });
});
