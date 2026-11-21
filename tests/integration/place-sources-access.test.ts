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

// `place_sources` (PR-B of the collection files) on the real database as krajozbior_app
// (docs/data-isolation.md, section 5): public like the place it describes, written by a member
// with `full_edit`. `app` is a pooled connection with one connection, so a leaked context would
// show. The superuser connection only prepares rows no policy lets a curator write.
const rejectedByPolicy = /row-level security/;
const noPermission = /permission denied/;

let db: ScratchDatabase;
let app: MikroORM;

const user = (name: string) => ({ id: randomUUID(), email: `${name}@example.com` });
const curA = user("cur-a");
const curB = user("cur-b");
const curS = user("cur-s");
const explorer = user("explorer");
const actors = { curA, curB, curS, explorer };

let orgA = "";
let orgB = "";
let orgS = "";

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);

const as = (actor: { id: string }, sql: string, params: unknown[] = []) =>
  runInUserContext(app.em, actor, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));
const asGuest = (sql: string, params: unknown[] = []) =>
  runInGuestContext(app.em, ({ em }) => em.execute<Record<string, unknown>[]>(sql, params));

let counter = 0;

const newPlace = async (actor: { id: string }, organizationId: string): Promise<string> =>
  (
    await as(
      actor,
      `insert into public.places (organization_id, name, latitude, longitude)
       values (?, 'Miejsce', 54.1, 18.7) returning id`,
      [organizationId],
    )
  )[0]!.id as string;

const insertSource = (
  actor: { id: string },
  organizationId: string,
  placeId: string,
  extra: {
    method?: string;
    attribution?: string;
    wikipedia?: string | null;
    qid?: string | null;
  } = {},
) =>
  as(
    actor,
    `insert into public.place_sources
       (place_id, organization_id, wikidata_qid, wikipedia_url, description_method, attribution, retrieved_at)
     values (?, ?, ?, ?, ?, ?, '2026-11-18T10:00:00Z') returning place_id`,
    [
      placeId,
      organizationId,
      extra.qid ?? null,
      extra.wikipedia ?? null,
      extra.method ?? "facts_template",
      extra.attribution ?? "Źródło (CC BY 4.0)",
    ],
  );

// A published collection of organization A that holds the place, prepared by the superuser.
const publish = async (placeId: string, organizationId: string) => {
  const [{ id }] = await admin$<{ id: string }>(
    `insert into public.collections (slug, organization_id, title, region, status)
     values ($1, $2, 'Publiczna', 'pomorskie', 'draft') returning id`,
    [`publiczna-${(counter += 1)}`, organizationId],
  );

  await admin$(
    `insert into public.collection_places (collection_id, place_id, organization_id, position)
     values ($1, $2, $3, 1)`,
    [id, placeId, organizationId],
  );
  await admin$(`update public.collections set status = 'published' where id = $1`, [id]);
};

const sourceRows = (placeId: string) =>
  admin$<{ description_method: string; attribution: string }>(
    `select description_method, attribution from public.place_sources where place_id = $1`,
    [placeId],
  );

describe("place sources", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_place_sources");
    await db.migrate();

    for (const { id, email } of Object.values(actors)) {
      await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
        id,
        email.split("@")[0],
        email,
      ]);
    }

    const org = async (name: string, slugValue: string, member: { id: string }) => {
      const [{ id }] = await admin$<{ id: string }>(
        `insert into public.organizations (name, slug, kind) values ($1, $2, 'municipality') returning id`,
        [name, slugValue],
      );

      await admin$(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [id, member.id],
      );

      return id;
    };

    orgA = await org("Gmina A", "gmina-a", curA);
    orgB = await org("Gmina B", "gmina-b", curB);
    orgS = await org("Gmina S", "gmina-s", curS);

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("has row security enabled, forced and policies on the table, and a safe app role", async () => {
    const gaps = await withClient(db.adminUrl, async (client) => [
      ...(await findRowLevelSecurityGaps(client, ["public.place_sources"])),
      ...(await findApplicationRoleGaps(client)),
    ]);

    expect(gaps).toEqual([]);
  });

  it("gives krajozbior_app exactly the intended privileges and no other role any", async () => {
    const [p] = await admin$<Record<string, boolean>>(
      `select
         has_table_privilege('krajozbior_app', 'place_sources', 'select') as s_select,
         has_table_privilege('krajozbior_app', 'place_sources', 'delete, truncate, references, trigger, insert, update') as s_table_write,
         has_column_privilege('krajozbior_app', 'place_sources', 'place_id', 'insert') as s_id_insert,
         has_column_privilege('krajozbior_app', 'place_sources', 'organization_id', 'insert') as s_org_insert,
         has_column_privilege('krajozbior_app', 'place_sources', 'attribution', 'insert, update') as s_attr,
         has_column_privilege('krajozbior_app', 'place_sources', 'description_method', 'update') as s_method_update,
         has_column_privilege('krajozbior_app', 'place_sources', 'place_id', 'update') as s_id_update,
         has_column_privilege('krajozbior_app', 'place_sources', 'organization_id', 'update') as s_org_update,
         has_any_column_privilege('krajozbior_auth', 'place_sources', 'select, insert, update') as auth_s,
         has_any_column_privilege('krajozbior_ops', 'place_sources', 'select, insert, update') as ops_s`,
    );

    expect(p).toEqual({
      s_select: true,
      s_table_write: false,
      s_id_insert: true,
      s_org_insert: true,
      s_attr: true,
      s_method_update: true,
      s_id_update: false,
      s_org_update: false,
      auth_s: false,
      ops_s: false,
    });
  });

  it("lets a full_edit member write the source of the own place and read it back", async () => {
    const placeId = await newPlace(curA, orgA);

    expect(await insertSource(curA, orgA, placeId, { qid: "Q42" })).toHaveLength(1);
    expect(
      await as(
        curA,
        `update public.place_sources set description_method = 'curator' where place_id = ? returning description_method`,
        [placeId],
      ),
    ).toEqual([{ description_method: "curator" }]);
    expect(
      await as(curA, `select wikidata_qid from public.place_sources where place_id = ?`, [placeId]),
    ).toEqual([{ wikidata_qid: "Q42" }]);
  });

  it("shows the source of a place in a published collection to a guest, and of a draft place to nobody outside", async () => {
    const shown = await newPlace(curA, orgA);
    const hidden = await newPlace(curA, orgA);

    await insertSource(curA, orgA, shown, { attribution: "Publiczne" });
    await insertSource(curA, orgA, hidden, { attribution: "Szkic" });
    await publish(shown, orgA);

    const mine = `select attribution from public.place_sources where attribution in ('Publiczne', 'Szkic')`;
    const names = (rows: Record<string, unknown>[]) => rows.map((row) => row.attribution).sort();

    expect(names(await asGuest(mine))).toEqual(["Publiczne"]);
    expect(names(await as(explorer, mine))).toEqual(["Publiczne"]);
    // Another organization sees the same as a guest; the own draft stays with the owner.
    expect(names(await as(curB, mine))).toEqual(["Publiczne"]);
    expect(names(await as(curA, mine))).toEqual(["Publiczne", "Szkic"]);
  });

  it("accepts no write from a guest, an explorer, another organization or a suspended one", async () => {
    const placeId = await newPlace(curA, orgA);

    await insertSource(curA, orgA, placeId, { attribution: "Oryginał" });
    await publish(placeId, orgA);

    await expect(
      asGuest(
        `insert into public.place_sources (place_id, organization_id, description_method, attribution, retrieved_at)
         values (?, ?, 'curator', 'x', now())`,
        [randomUUID(), orgA],
      ),
    ).rejects.toThrow(/read-only/);

    // Even though they can read the source of a public place, nobody else can change it.
    for (const actor of [explorer, curB]) {
      expect(
        await as(
          actor,
          `update public.place_sources set attribution = 'Zmienione' where place_id = ? returning 1`,
          [placeId],
        ),
      ).toEqual([]);
    }

    await expect(insertSource(explorer, orgA, await newPlace(curA, orgA))).rejects.toThrow(
      rejectedByPolicy,
    );
    // A member of B cannot attach a source to a place of A, naming either organization.
    const foreign = await newPlace(curA, orgA);

    await expect(insertSource(curB, orgA, foreign)).rejects.toThrow(rejectedByPolicy);
    await expect(insertSource(curB, orgB, foreign)).rejects.toThrow(
      /foreign key|row-level security/,
    );
    expect(await sourceRows(placeId)).toEqual([
      { description_method: "facts_template", attribution: "Oryginał" },
    ]);

    // A suspended organization loses the right to write.
    const suspendedPlace = await newPlace(curS, orgS);

    await admin$(`update public.organizations set status = 'suspended' where id = $1`, [orgS]);
    await expect(insertSource(curS, orgS, suspendedPlace)).rejects.toThrow(rejectedByPolicy);
  });

  it("ties the row to the organization of the place and keeps its shape", async () => {
    const placeId = await newPlace(curA, orgA);

    // The organization of the row must be the one of the place (composite foreign key, 23503).
    await expect(insertSource(curB, orgB, placeId)).rejects.toThrow(
      /foreign key|row-level security/,
    );
    await expect(insertSource(curA, orgA, placeId, { method: "model" })).rejects.toThrow(
      /description_method_check/,
    );
    await expect(insertSource(curA, orgA, placeId, { attribution: "" })).rejects.toThrow(
      /attribution_check/,
    );
    await expect(
      insertSource(curA, orgA, placeId, { attribution: "x".repeat(501) }),
    ).rejects.toThrow(/attribution_check/);
    await expect(
      insertSource(curA, orgA, placeId, { wikipedia: "https://example.com/wiki/Zamek" }),
    ).rejects.toThrow(/wikipedia_url_check/);
    await expect(insertSource(curA, orgA, placeId, { qid: "42" })).rejects.toThrow(
      /wikidata_qid_check/,
    );
    // The identity of a row cannot be changed afterwards.
    await insertSource(curA, orgA, placeId);
    await expect(
      as(curA, `update public.place_sources set organization_id = ? where place_id = ?`, [
        orgB,
        placeId,
      ]),
    ).rejects.toThrow(noPermission);
  });

  it("gives the table owner no policy: it neither reads nor writes the rows", async () => {
    const placeId = await newPlace(curA, orgA);

    await insertSource(curA, orgA, placeId);
    expect(
      await withClient(
        db.urls.krajozbior_owner,
        async (client) => (await client.query(`select 1 from public.place_sources`)).rows,
      ),
    ).toEqual([]);
    await expect(
      withClient(db.urls.krajozbior_owner, (client) =>
        client.query(
          `insert into public.place_sources (place_id, organization_id, description_method, attribution, retrieved_at)
           values ($1, $2, 'curator', 'x', now())`,
          [placeId, orgA],
        ),
      ),
    ).rejects.toThrow(rejectedByPolicy);
  });

  it("does not inherit rights: an administrator without membership neither writes nor changes a source", async () => {
    const { opsRoleAssigner } = await import("@/features/identity/infrastructure/user-role");
    const administrator = user("administrator");
    const placeId = await newPlace(curA, orgA);

    await admin$(`insert into auth.users (id, name, email) values ($1, 'administrator', $2)`, [
      administrator.id,
      administrator.email,
    ]);
    expect(
      await opsRoleAssigner(db.urls.krajozbior_ops)(administrator.email, "admin", {
        operator: "tester",
        reason: "Test roli",
      }),
    ).toMatchObject({ outcome: "applied" });
    expect(await admin$(`select role from auth.users where id = $1`, [administrator.id])).toEqual([
      { role: "admin" },
    ]);

    await insertSource(curA, orgA, placeId, { attribution: "Oryginał" });
    await expect(insertSource(administrator, orgA, await newPlace(curA, orgA))).rejects.toThrow(
      rejectedByPolicy,
    );
    expect(
      await as(
        administrator,
        `update public.place_sources set attribution = 'Zmienione' where place_id = ? returning 1`,
        [placeId],
      ),
    ).toEqual([]);
    expect(await sourceRows(placeId)).toEqual([
      { description_method: "facts_template", attribution: "Oryginał" },
    ]);
  });

  it("removes the source together with the place", async () => {
    const placeId = await newPlace(curA, orgA);

    await insertSource(curA, orgA, placeId);
    expect(
      await as(curA, `delete from public.places where id = ? returning id`, [placeId]),
    ).toHaveLength(1);
    expect(await sourceRows(placeId)).toEqual([]);
    // krajozbior_app has no DELETE on the table itself.
    await expect(as(curA, `delete from public.place_sources`)).rejects.toThrow(noPermission);
  });

  it("does not leak the actor to the next transaction on the same connection", async () => {
    const placeId = await newPlace(curA, orgA);

    await insertSource(curA, orgA, placeId, { attribution: "Tylko A" });
    expect(
      (await as(curA, `select 1 from public.place_sources where attribution = 'Tylko A'`)).length,
    ).toBe(1);
    expect(
      await asGuest(`select 1 from public.place_sources where attribution = 'Tylko A'`),
    ).toEqual([]);
    expect(
      await app.em.execute(`select 1 from public.place_sources where attribution = 'Tylko A'`),
    ).toEqual([]);
  });
});
