import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deleteExpiredSessions } from "@/features/identity/infrastructure/postgres-expired-sessions-cleanup";
import {
  closePool,
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// Removal of expired sessions as krajozbior_auth (the retention in the privacy
// policy): expired rows go, active rows (also of other accounts) stay, a batch
// is bounded, and other roles cannot delete sessions at all.
let db: ScratchDatabase;
let pool: Pool;

const admin$ = (sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, (client) => client.query(sql, params));

async function addUser(email: string): Promise<string> {
  const { rows } = await admin$(
    `insert into auth.users (name, email) values ('Test', $1) returning id`,
    [email],
  );

  return rows[0].id as string;
}

async function addSession(userId: string, token: string, expires: string) {
  await admin$(
    `insert into auth.sessions (user_id, token, expires_at)
     values ($1, $2, now() + $3::interval)`,
    [userId, token, expires],
  );
}

const tokens = async () =>
  (await admin$(`select token from auth.sessions order by token`)).rows.map(
    (row) => row.token as string,
  );

describe("deleteExpiredSessions", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_expired_sessions");
    await db.migrate();
    pool = new Pool({ connectionString: db.urls.krajozbior_auth, max: 2 });
  }, 60_000);

  beforeEach(async () => {
    await admin$("truncate auth.users cascade");
  });

  afterAll(async () => {
    if (pool) await closePool(pool);
    await db?.drop();
  });

  it("removes expired sessions and keeps active ones, also of other accounts", async () => {
    const a = await addUser("a@example.test");
    const b = await addUser("b@example.test");

    await addSession(a, "a-expired", "-1 hour");
    await addSession(a, "a-active", "1 day");
    await addSession(b, "b-expired", "-40 days");
    await addSession(b, "b-active", "29 days");

    expect(await deleteExpiredSessions(pool)).toBe(2);
    expect(await tokens()).toEqual(["a-active", "b-active"]);
  });

  it("removes at most one batch per call and continues on the next", async () => {
    const a = await addUser("a@example.test");

    for (let i = 0; i < 5; i += 1) {
      await addSession(a, `old-${i}`, "-1 day");
    }
    await addSession(a, "active", "1 day");

    expect(await deleteExpiredSessions(pool, 3)).toBe(3);
    expect(await deleteExpiredSessions(pool, 3)).toBe(2);
    expect(await deleteExpiredSessions(pool, 3)).toBe(0);
    expect(await tokens()).toEqual(["active"]);
  });

  it("does nothing on an empty table", async () => {
    expect(await deleteExpiredSessions(pool)).toBe(0);
  });

  it("only krajozbior_auth may delete sessions (the application role is refused)", async () => {
    const a = await addUser("a@example.test");

    await addSession(a, "a-expired", "-1 hour");

    const appPool = new Pool({ connectionString: db.urls.krajozbior_app, max: 1 });

    try {
      await expect(deleteExpiredSessions(appPool)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await closePool(appPool);
    }

    expect(await tokens()).toEqual(["a-expired"]);
  });
});
