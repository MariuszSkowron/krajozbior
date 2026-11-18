import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { opsRoleAssigner } from "@/features/identity/infrastructure/user-role";
import { createOrmConfig } from "@/lib/db/config";
import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// E9-5: POST /api/me/account/deletion through the real route handler, with real
// sessions of Better Auth, the real use case and the real roles (krajozbior_app,
// krajozbior_auth); the superuser connection `orm` only prepares and reads data.
// The cascade and the audit entry themselves are proven in account-deletion.test.ts.
const PASSWORD = "integration-only-password";
const DOMAIN = "demo.krajozbior.local";

type Handler = (request: Request) => Promise<Response>;

let db: ScratchDatabase;
let orm: MikroORM;
let login: Handler;
let deletion: Handler;
let me: Handler;
let closeAuth: () => Promise<void>;

const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

async function signIn(email: string): Promise<string> {
  const response = await login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${email}@${DOMAIN}`, password: PASSWORD }),
    }),
  );

  expect(response.status, `sign-in of ${email}`).toBe(200);

  return cookieOf(response);
}

const post = (body: unknown, cookie?: string) =>
  deletion(
    new Request("http://localhost/api/me/account/deletion", {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );

const meStatus = async (cookie: string) =>
  (await me(new Request("http://localhost/api/me", { headers: { cookie } }))).status;

const idOf = async (email: string) =>
  (
    await orm.em.execute<{ id: string }[]>(`select id from auth.users where email = ?`, [
      `${email}@${DOMAIN}`,
    ])
  )[0]?.id;

const exists = async (email: string) => (await idOf(email)) !== undefined;

async function organization(slug: string, members: string[]) {
  const [{ id }] = await orm.em.execute<{ id: string }[]>(
    `insert into public.organizations (name, slug, kind) values (?, ?, 'municipality') returning id`,
    [slug, slug],
  );

  for (const member of members) {
    await orm.em.execute(
      `insert into public.organization_members (organization_id, user_id) values (?, ?)`,
      [id, await idOf(member)],
    );
  }

  return id as string;
}

describe("POST /api/me/account/deletion", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_account_route");
    await db.migrate();
    orm = await MikroORM.init(createOrmConfig(db.adminUrl));

    process.env.DATABASE_URL = db.urls.krajozbior_app;
    process.env.DATABASE_AUTH_URL = db.urls.krajozbior_auth;
    process.env.BETTER_AUTH_SECRET = "integration-only-secret-0123456789abcdef";
    delete process.env.BETTER_AUTH_URL;

    ({ POST: login } = await import("@/app/api/auth/login/route"));
    ({ POST: deletion } = await import("@/app/api/me/account/deletion/route"));
    ({ GET: me } = await import("@/app/api/me/route"));
    ({ closeAuth } = await import("@/features/identity/infrastructure/better-auth"));

    const { seedDemoAccounts } = await import("@/features/identity/infrastructure/demo-accounts");

    await seedDemoAccounts(PASSWORD, opsRoleAssigner(db.urls.krajozbior_ops));
  }, 60_000);

  beforeEach(async () => {
    await orm.em.execute("truncate auth.sign_in_throttle");
  });

  afterAll(async () => {
    await closeAuth?.();
    await orm?.close(true);
    await db?.drop();
  });

  it("answers a guest 401 and removes nothing", async () => {
    const before = Number(
      (await orm.em.execute<{ n: string }[]>(`select count(*) as n from auth.users`))[0]!.n,
    );

    expect((await post({ confirmation: "USUŃ" })).status).toBe(401);
    expect((await post({ confirmation: "USUŃ", userId: await idOf("user") })).status).toBe(401);
    expect(
      Number((await orm.em.execute<{ n: string }[]>(`select count(*) as n from auth.users`))[0]!.n),
    ).toBe(before);
  });

  it("does not let an explorer name another account: an extra field is refused (400) and B stays", async () => {
    const cookie = await signIn("user");
    const response = await post({ confirmation: "USUŃ", userId: await idOf("user2") }, cookie);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(await exists("user")).toBe(true);
    expect(await exists("user2")).toBe(true);
  });

  it("refuses a wrong word with 422", async () => {
    const response = await post({ confirmation: "tak" }, await signIn("user"));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_confirmation" });
    expect(await exists("user")).toBe(true);
  });

  it("refuses an administrator (409 managed_account): the operator removes that account", async () => {
    const response = await post({ confirmation: "USUŃ" }, await signIn("admin"));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "managed_account" });
    expect(await exists("admin")).toBe(true);
  });

  it("refuses the only member of an organization (409 managed_account) and keeps the organization", async () => {
    const org = await organization("only-member-org", ["curator-a"]);
    const response = await post({ confirmation: "USUŃ" }, await signIn("curator-a"));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "managed_account" });
    expect(await exists("curator-a")).toBe(true);
    expect(
      await orm.em.execute(`select 1 from public.organization_members where organization_id = ?`, [
        org,
      ]),
    ).toHaveLength(1);
  });

  it("asks for a new sign-in when the session is older than 15 minutes (409 stale_session)", async () => {
    const cookie = await signIn("user2");

    await orm.em.execute(
      `update auth.sessions set created_at = now() - interval '16 minutes'
        where user_id = (select id from auth.users where email = ?)`,
      [`user2@${DOMAIN}`],
    );

    const response = await post({ confirmation: "USUŃ" }, cookie);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "stale_session" });
    expect(await exists("user2")).toBe(true);
  });

  it("deletes the account: 303, cookie cleared, the second browser stops working, B untouched, one audit entry", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const id = (await idOf("user"))!;
    const otherId = (await idOf("user2"))!;
    const firstBrowser = await signIn("user");
    const secondBrowser = await signIn("user");

    expect(await meStatus(secondBrowser)).toBe(200);

    const response = await post({ confirmation: "USUŃ" }, firstBrowser);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?konto=usuniete");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.getSetCookie().join("\n")).toMatch(/session_token=;[^\n]*Max-Age=0/);

    expect(await meStatus(firstBrowser)).toBe(401);
    expect(await meStatus(secondBrowser)).toBe(401);
    expect(await exists("user")).toBe(false);
    expect(await exists("user2")).toBe(true);

    const entries = await orm.em.execute<Record<string, unknown>[]>(
      `select operation, outcome, operator_label, recorded_by from public.operations_audit
        where subject_user_id = ?`,
      [id],
    );

    expect(entries).toEqual([
      {
        operation: "delete_account",
        outcome: "applied",
        operator_label: "self-service",
        recorded_by: "krajozbior_auth",
      },
    ]);
    expect(
      await orm.em.execute(`select 1 from public.operations_audit where subject_user_id = ?`, [
        otherId,
      ]),
    ).toEqual([]);
    // The log holds the event only: no account id, no address.
    const logged = JSON.stringify(info.mock.calls);

    expect(logged).toContain("account.deleted");
    expect(logged).not.toContain(id);
    expect(logged).not.toContain("user@");
    info.mockRestore();

    // The deleted account cannot sign in any more.
    const again = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `user@${DOMAIN}`, password: PASSWORD }),
      }),
    );

    expect(again.status).toBe(401);
  });

  it("lets a curator with a colleague delete the account: the organization and its content stay (Q8)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const org = await organization("two-member-org", ["curator-b", "user2"]);
    const [{ id: placeId }] = await orm.em.execute<{ id: string }[]>(
      `insert into public.places (organization_id, name, latitude, longitude, visit_radius_m)
       values (?, 'Miejsce', 54.0, 18.0, 200) returning id`,
      [org],
    );
    const response = await post({ confirmation: "USUŃ" }, await signIn("curator-b"));

    expect(response.status).toBe(303);
    expect(await exists("curator-b")).toBe(false);
    expect(
      await orm.em.execute(`select 1 from public.organizations where id = ?`, [org]),
    ).toHaveLength(1);
    expect(
      await orm.em.execute(`select 1 from public.places where id = ?`, [placeId]),
    ).toHaveLength(1);
    vi.restoreAllMocks();
  });
});
