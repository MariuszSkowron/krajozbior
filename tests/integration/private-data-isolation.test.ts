import { randomUUID } from "node:crypto";

import { MikroORM, type EntityManager } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOrmConfig } from "@/lib/db/config";
import { privateTableSecuritySql } from "@/lib/db/policies";
import {
  InvalidActorIdError,
  NestedUserContextError,
  runInUserContext,
} from "@/lib/db/user-context";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findRowLevelSecurityGaps } from "../support/rls-guard";

// The PRIV pattern and withUserContext of issue #21, proven on a technical
// control table created only for this test. Real PRIV tables (visits #14,
// saved places and collections E05) repeat these A/B checks on themselves.
const TABLE = "public.integration_private_records";

let db: ScratchDatabase;
let app: MikroORM;

const alice = { id: randomUUID() };
const bob = { id: randomUUID() };

const rejectedByPolicy = /row-level security/;

type Note = { note: string };

const notesOf = (em: EntityManager) =>
  em.execute<Note[]>(`select note from ${TABLE} order by note`);

describe("private data isolation", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_private_data");
    await db.migrate();

    // The table and its policies come from one migration-like step run as the owner.
    await withClient(db.urls.krajozbior_owner, async (client) => {
      await client.query(`create table ${TABLE} (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        note text not null
      )`);
      for (const sql of privateTableSecuritySql(TABLE, {
        operations: ["select", "insert", "update", "delete"],
      })) {
        await client.query(sql);
      }
    });

    // One pooled connection: every test reuses the same session, so a leaked
    // `app.user_id` would show up in the next transaction.
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });

    for (const [actor, note] of [
      [alice, "alice-1"],
      [bob, "bob-1"],
    ] as const) {
      await runInUserContext(app.em, actor, ({ em }) =>
        em.execute(`insert into ${TABLE} (user_id, note) values (?, ?)`, [actor.id, note]),
      );
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("passes the catalog guard and the guard flags a table without row security", async () => {
    await withClient(db.urls.krajozbior_owner, (client) =>
      client.query("create table public.integration_unprotected (id int)"),
    );

    const gaps = await withClient(db.adminUrl, (client) =>
      findRowLevelSecurityGaps(client, [TABLE, "public.integration_unprotected", "public.missing"]),
    );

    expect(gaps).toEqual([
      "public.integration_unprotected: row level security is not enabled",
      "public.integration_unprotected: row level security is not forced",
      "public.integration_unprotected: no policies",
      "public.missing: table does not exist",
    ]);
  });

  it("shows nothing and accepts no write without a user context", async () => {
    expect(await notesOf(app.em)).toEqual([]);
    await expect(
      app.em.execute(`insert into ${TABLE} (user_id, note) values (?, 'anonymous')`, [alice.id]),
    ).rejects.toThrow(rejectedByPolicy);
  });

  it("shows each user only their own rows", async () => {
    expect(await runInUserContext(app.em, alice, ({ em }) => notesOf(em))).toEqual([
      { note: "alice-1" },
    ]);
    expect(await runInUserContext(app.em, bob, ({ em }) => notesOf(em))).toEqual([
      { note: "bob-1" },
    ]);
  });

  it("refuses to insert a row for another user", async () => {
    await expect(
      runInUserContext(app.em, alice, ({ em }) =>
        em.execute(`insert into ${TABLE} (user_id, note) values (?, 'forged')`, [bob.id]),
      ),
    ).rejects.toThrow(rejectedByPolicy);
  });

  it("does not let a user change, hand over or delete another user's row", async () => {
    const changed = await runInUserContext(app.em, alice, async ({ em }) => [
      ...(await em.execute(`update ${TABLE} set note = 'taken' where note = 'bob-1' returning id`)),
      ...(await em.execute(`delete from ${TABLE} where note = 'bob-1' returning id`)),
    ]);

    expect(changed).toEqual([]);
    await expect(
      runInUserContext(app.em, alice, ({ em }) =>
        em.execute(`update ${TABLE} set user_id = ? where note = 'alice-1'`, [bob.id]),
      ),
    ).rejects.toThrow(rejectedByPolicy);
    expect(await runInUserContext(app.em, bob, ({ em }) => notesOf(em))).toEqual([
      { note: "bob-1" },
    ]);
  });

  it("rolls back everything the work wrote when it fails", async () => {
    const failure = new Error("domain rule failed");

    await expect(
      runInUserContext(app.em, alice, async ({ em }) => {
        await em.execute(`insert into ${TABLE} (user_id, note) values (?, 'half-done')`, [
          alice.id,
        ]);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await runInUserContext(app.em, alice, ({ em }) => notesOf(em))).toEqual([
      { note: "alice-1" },
    ]);
  });

  it("does not carry the user into the next transaction on the same connection", async () => {
    const pid = (em: EntityManager) =>
      em.execute<{ pid: number }>("select pg_backend_pid() as pid", [], "get");
    const inside = await runInUserContext(app.em, alice, ({ em }) => pid(em));
    const after = await app.em.transactional((em) => pid(em));

    expect(after.pid).toBe(inside.pid);
    expect(await app.em.execute(`select app_current_user_id() as "userId"`, [], "get")).toEqual({
      userId: null,
    });
    expect(await notesOf(app.em)).toEqual([]);
  });

  it("refuses an actor id that is not a UUID instead of running without context", async () => {
    await expect(
      runInUserContext(app.em, { id: "not-a-uuid" }, ({ em }) => notesOf(em)),
    ).rejects.toBeInstanceOf(InvalidActorIdError);
  });

  it("refuses a user context nested in another one and keeps the outer actor", async () => {
    const currentUser = (em: EntityManager) =>
      em.execute<{ userId: string }>(`select app_current_user_id() as "userId"`, [], "get");

    const outer = await runInUserContext(app.em, alice, async ({ em }) => {
      for (const target of [app.em, em]) {
        await expect(
          runInUserContext(target, bob, ({ em: inner }) => notesOf(inner)),
        ).rejects.toBeInstanceOf(NestedUserContextError);
      }

      return { user: await currentUser(em), notes: await notesOf(em) };
    });

    expect(outer).toEqual({ user: { userId: alice.id }, notes: [{ note: "alice-1" }] });
  });
});
