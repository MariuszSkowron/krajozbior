import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { opsRoleAssigner } from "@/features/identity/infrastructure/user-role";
import { createOrmConfig } from "@/lib/db/config";
import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// Runs on its own scratch database so it does not depend on the order of the
// other integration files. Better Auth connects as krajozbior_auth and the
// application as krajozbior_app, like in production; `orm` is the superuser
// connection used only to inspect and change test data.
const PASSWORD = "integration-only-password";

type Handler = (request: Request) => Promise<Response>;

let db: ScratchDatabase;
let orm: MikroORM;
let login: Handler;
let logout: Handler;
let me: Handler;
let adminOnly: Handler;
let closeAuth: () => Promise<void>;

function jsonLogin(email: string, password: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email, password }),
  });
}

function cookieOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

// The seed sets roles as krajozbior_ops (with an audit entry), like `npm run db:seed:demo`.
const asOps = () => opsRoleAssigner(db.urls.krajozbior_ops);

async function signIn(role: "user" | "admin") {
  const response = await login(jsonLogin(`${role}@demo.krajozbior.local`, PASSWORD));

  return { response, cookie: cookieOf(response) };
}

function withCookie(path: string, cookie?: string, init: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: { ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string>) },
  });
}

describe("local demo login and role enforcement", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_identity");
    await db.migrate();
    orm = await MikroORM.init(createOrmConfig(db.adminUrl));

    process.env.DATABASE_URL = db.urls.krajozbior_app;
    process.env.DATABASE_AUTH_URL = db.urls.krajozbior_auth;
    process.env.BETTER_AUTH_SECRET = "integration-only-secret-0123456789abcdef";
    delete process.env.BETTER_AUTH_URL;

    ({ POST: login } = await import("@/app/api/auth/login/route"));
    ({ POST: logout } = await import("@/app/api/auth/logout/route"));
    ({ GET: me } = await import("@/app/api/me/route"));
    ({ GET: adminOnly } = await import("@/app/api/admin/route"));
    ({ closeAuth } = await import("@/features/identity/infrastructure/better-auth"));

    const { seedDemoAccounts } = await import("@/features/identity/infrastructure/demo-accounts");
    await seedDemoAccounts(PASSWORD, asOps());
  }, 60_000);

  // Several tests send wrong passwords to the same demo accounts; the sign-in
  // limiter (issue #39) must not carry those attempts from one test to the next.
  beforeEach(async () => {
    await orm.em.execute("truncate auth.sign_in_throttle");
  });

  afterAll(async () => {
    await closeAuth?.();
    await orm?.close(true);
    await db?.drop();
  });

  it("stores users with a constrained role and a hashed password", async () => {
    const rows = await orm.em.execute<{ email: string; role: string; hasHash: boolean }[]>(
      `select u.email, u.role, (a.password is not null and a.password <> ?) as "hasHash"
         from auth.users u join auth.accounts a on a.user_id = u.id
        order by u.email collate "C"`,
      [PASSWORD],
    );

    expect(rows).toEqual([
      { email: "admin@demo.krajozbior.local", role: "admin", hasHash: true },
      { email: "curator-a@demo.krajozbior.local", role: "user", hasHash: true },
      { email: "curator-b@demo.krajozbior.local", role: "user", hasHash: true },
      { email: "user2@demo.krajozbior.local", role: "user", hasHash: true },
      { email: "user@demo.krajozbior.local", role: "user", hasHash: true },
    ]);
    await expect(
      orm.em.execute(`update auth.users set role = 'root' where email like 'user@%'`),
    ).rejects.toThrow();
  });

  it("repairs a user left without a credential account by an interrupted seed", async () => {
    const { seedDemoAccounts } = await import("@/features/identity/infrastructure/demo-accounts");

    await orm.em.execute(
      `delete from auth.accounts where user_id = (select id from auth.users where email = 'user@demo.krajozbior.local')`,
    );
    expect((await signIn("user")).response.status).toBe(401);

    await seedDemoAccounts(PASSWORD, asOps());

    expect((await signIn("user")).response.status).toBe(200);
  });

  it("resets role, name, password and sessions of every demo account on a repeated seed", async () => {
    const { demoAccounts, seedDemoAccounts } =
      await import("@/features/identity/infrastructure/demo-accounts");
    const otherPassword = "another-integration-password";
    const cookies: string[] = [];

    for (const { email } of demoAccounts) {
      const response = await login(jsonLogin(email, PASSWORD));
      const cookie = cookieOf(response);

      expect(response.status).toBe(200);
      expect((await me(withCookie("/api/me", cookie))).status).toBe(200);
      cookies.push(cookie);
    }

    try {
      // The name changes by plain SQL (no trigger: `role` is untouched); the role
      // changes the way production does, through ops with an audit entry. The
      // database refuses a bare `update ... set role` (operations-audit-access).
      await orm.em.execute(
        `update auth.users set name = 'Changed' where email like '%@demo.krajozbior.local'`,
      );
      for (const { email } of demoAccounts) {
        await asOps()(email, "admin", { operator: "test", reason: "Test ponownego seeda" });
      }

      await seedDemoAccounts(otherPassword, asOps());

      const rows = await orm.em.execute<{ email: string; role: string; name: string }[]>(
        `select email, role, name from auth.users where email like '%@demo.krajozbior.local'`,
      );

      expect(rows).toHaveLength(demoAccounts.length);
      for (const { email, role, name } of demoAccounts) {
        expect(rows).toContainEqual({ email, role, name });
      }
      for (const cookie of cookies) {
        expect((await me(withCookie("/api/me", cookie))).status).toBe(401);
      }

      for (const { email } of demoAccounts) {
        expect((await login(jsonLogin(email, PASSWORD))).status).toBe(401);
        expect((await login(jsonLogin(email, otherPassword))).status).toBe(200);
      }
    } finally {
      // A failed assertion must not leave the accounts unusable for later tests.
      await seedDemoAccounts(PASSWORD, asOps());
    }
  });

  it("ends the previous session when the browser signs in again", async () => {
    const first = await signIn("user");
    const second = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: first.cookie },
        body: JSON.stringify({ email: "admin@demo.krajozbior.local", password: PASSWORD }),
      }),
    );

    expect(second.status).toBe(200);
    expect((await me(withCookie("/api/me", first.cookie))).status).toBe(401);
    expect((await adminOnly(withCookie("/api/admin", cookieOf(second)))).status).toBe(200);
  });

  it("keeps the current session when a later login fails", async () => {
    const { cookie } = await signIn("user");
    const failed = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          email: "admin@demo.krajozbior.local",
          password: "not-the-password",
        }),
      }),
    );

    expect(failed.status).toBe(401);
    expect((await me(withCookie("/api/me", cookie))).status).toBe(200);
  });

  it("lists the seeded demo accounts by email and role only", async () => {
    const { findSeededDemoAccounts } =
      await import("@/features/identity/infrastructure/demo-accounts");

    expect(await findSeededDemoAccounts()).toEqual([
      { email: "user@demo.krajozbior.local", role: "user" },
      { email: "user2@demo.krajozbior.local", role: "user" },
      { email: "admin@demo.krajozbior.local", role: "admin" },
      { email: "curator-a@demo.krajozbior.local", role: "user" },
      { email: "curator-b@demo.krajozbior.local", role: "user" },
    ]);
  });

  it("gives the second user an own session, distinct from the first", async () => {
    const first = await signIn("user");
    const second = await login(jsonLogin("user2@demo.krajozbior.local", PASSWORD));
    const secondCookie = cookieOf(second);

    expect(second.status).toBe(200);

    const firstMe = await (await me(withCookie("/api/me", first.cookie))).json();
    const secondMe = await (await me(withCookie("/api/me", secondCookie))).json();

    expect(secondMe.role).toBe("user");
    expect(secondMe.id).not.toBe(firstMe.id);
    expect((await adminOnly(withCookie("/api/admin", secondCookie))).status).toBe(403);
  });

  it("denies a guest on the account and admin routes", async () => {
    expect((await me(withCookie("/api/me"))).status).toBe(401);
    expect((await adminOnly(withCookie("/api/admin"))).status).toBe(401);
  });

  it("sends a guest browser to login without running the action", async () => {
    const response = await me(
      withCookie("/api/me", undefined, { headers: { accept: "text/html" } }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/login?returnTo=%2Fapi%2Fme");
  });

  it("gives each demo role a session with that role", async () => {
    for (const role of ["user", "admin"] as const) {
      const { response, cookie } = await signIn(role);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ role });
      expect(response.headers.getSetCookie().join(";")).toMatch(/HttpOnly/i);

      const mine = await me(withCookie("/api/me", cookie));
      expect(mine.status).toBe(200);
      expect(await mine.json()).toMatchObject({ role });
    }
  });

  it("denies the admin route to a user with 403", async () => {
    const { cookie } = await signIn("user");

    expect((await adminOnly(withCookie("/api/admin", cookie))).status).toBe(403);
  });

  it("allows the admin route to an admin", async () => {
    const { cookie } = await signIn("admin");
    const response = await adminOnly(withCookie("/api/admin", cookie));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role: "admin" });
  });

  it("rejects wrong password and unknown account with the same answer", async () => {
    const wrongPassword = await login(jsonLogin("user@demo.krajozbior.local", "not-the-password"));
    const unknownAccount = await login(jsonLogin("nobody@demo.krajozbior.local", PASSWORD));

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownAccount.json());
    expect(wrongPassword.headers.getSetCookie()).toEqual([]);
  });

  it("treats a forged session cookie as no session", async () => {
    const response = await me(withCookie("/api/me", "krajozbior.session_token=forged"));

    expect(response.status).toBe(401);
  });

  it("ignores a role claimed by the client", async () => {
    const { cookie } = await signIn("user");
    const response = await adminOnly(
      withCookie("/api/admin", cookie, {
        headers: { "x-role": "admin", "x-user-role": "admin" },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("ends the session on logout and treats repeated logout as success", async () => {
    const { cookie } = await signIn("user");

    const first = await logout(withCookie("/api/auth/logout", cookie, { method: "POST" }));
    expect(first.status).toBe(204);

    // The old cookie value must no longer authenticate: the session is gone server-side.
    expect((await me(withCookie("/api/me", cookie))).status).toBe(401);

    const second = await logout(withCookie("/api/auth/logout", cookie, { method: "POST" }));
    expect(second.status).toBe(204);
  });

  it("refuses a cross-origin login attempt", async () => {
    const response = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          host: "localhost",
        },
        body: JSON.stringify({ email: "user@demo.krajozbior.local", password: PASSWORD }),
      }),
    );

    expect(response.status).toBe(403);
  });

  describe("absolute session lifetime (issue #39)", () => {
    const tokenOf = (cookie: string) =>
      decodeURIComponent(cookie.split("=")[1] ?? "").split(".")[0];

    it("answers a request with an expired session with 401", async () => {
      const { cookie } = await signIn("user");

      await orm.em.execute(
        `update auth.sessions set expires_at = now() - interval '1 second' where token = ?`,
        [tokenOf(cookie)],
      );

      expect((await me(withCookie("/api/me", cookie))).status).toBe(401);
    });

    it("does not extend a session when it is read", async () => {
      const { cookie } = await signIn("user");
      const token = tokenOf(cookie);

      // Older than Better Auth's refresh threshold, so a refresh would move it.
      await orm.em.execute(
        `update auth.sessions
            set updated_at = now() - interval '2 hours',
                expires_at = now() + interval '10 hours'
          where token = ?`,
        [token],
      );
      const [before] = await orm.em.execute<{ expiresAt: Date }[]>(
        `select expires_at as "expiresAt" from auth.sessions where token = ?`,
        [token],
      );

      expect((await me(withCookie("/api/me", cookie))).status).toBe(200);

      const [after] = await orm.em.execute<{ expiresAt: Date }[]>(
        `select expires_at as "expiresAt" from auth.sessions where token = ?`,
        [token],
      );

      expect(after.expiresAt).toEqual(before.expiresAt);
    });
  });

  it("marks the session cookie Secure with the __Secure- prefix for an https address (issue #39)", async () => {
    await closeAuth();
    process.env.BETTER_AUTH_URL = "https://localhost";
    try {
      const [cookie] = (await signIn("user")).response.headers.getSetCookie();

      expect(cookie).toMatch(/^__Secure-krajozbior\.session_token=/);
      expect(cookie).toMatch(/; Secure/i);
    } finally {
      await closeAuth();
      delete process.env.BETTER_AUTH_URL;
    }
  });

  describe("sign-in limit (issue #39)", () => {
    const USER = "user@demo.krajozbior.local";
    const fromIp = (ip: string) => ({ "x-real-ip": ip });

    async function failTimes(times: number, email: string, headers: Record<string, string> = {}) {
      for (let i = 0; i < times; i += 1) {
        expect((await login(jsonLogin(email, "not-the-password", headers))).status).toBe(401);
      }
    }

    function withIpHeader(work: () => Promise<void>) {
      return async () => {
        process.env.AUTH_CLIENT_IP_HEADER = "x-real-ip";
        try {
          await work();
        } finally {
          delete process.env.AUTH_CLIENT_IP_HEADER;
        }
      };
    }

    it("answers the attempt after five failures with 429, even with the right password", async () => {
      await failTimes(5, USER);

      const response = await login(jsonLogin(USER, PASSWORD));

      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: "too_many_attempts" });
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.getSetCookie()).toEqual([]);
    });

    it("limits an unknown account exactly like an existing one", async () => {
      await failTimes(5, "nobody@demo.krajozbior.local");

      const response = await login(jsonLogin("nobody@demo.krajozbior.local", PASSWORD));

      expect(response.status).toBe(429);
    });

    it("sends a browser form back to login with the limit message", async () => {
      await failTimes(5, USER);

      const response = await login(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ email: USER, password: PASSWORD, returnTo: "/my" }),
        }),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "/login?error=too_many_attempts&returnTo=%2Fmy",
      );
    });

    it("resets the account counter after a successful sign-in", async () => {
      await failTimes(4, USER);
      expect((await signIn("user")).response.status).toBe(200);

      await failTimes(4, USER);
      expect((await signIn("user")).response.status).toBe(200);
    });

    it(
      "lets the owner sign in from another address while a stranger is locked out",
      withIpHeader(async () => {
        await failTimes(5, USER, fromIp("203.0.113.7"));

        expect((await login(jsonLogin(USER, PASSWORD, fromIp("203.0.113.7")))).status).toBe(429);
        expect((await login(jsonLogin(USER, PASSWORD, fromIp("198.51.100.2")))).status).toBe(200);
      }),
    );

    it(
      "answers the 21st attempt from one address with 429",
      withIpHeader(async () => {
        for (let i = 0; i < 20; i += 1) {
          await login(
            jsonLogin(`guess${i}@demo.krajozbior.local`, "not-the-password", fromIp("203.0.113.9")),
          );
        }

        const response = await login(jsonLogin(USER, PASSWORD, fromIp("203.0.113.9")));

        expect(response.status).toBe(429);
      }),
    );

    it(
      "answers the 51st attempt on one account from many addresses with 429",
      withIpHeader(async () => {
        for (let i = 0; i < 50; i += 1) {
          await login(jsonLogin(USER, "not-the-password", fromIp(`192.0.2.${i + 1}`)));
        }

        const response = await login(jsonLogin(USER, PASSWORD, fromIp("198.51.100.77")));

        expect(response.status).toBe(429);
      }),
    );

    it("blocks an account by operator procedure and lifts the block again", async () => {
      const { getAuthPool } = await import("@/features/identity/infrastructure/better-auth");
      const { blockBucket, blockKey, throttleHmacKey, unblockBucket } =
        await import("@/features/identity/infrastructure/postgres-sign-in-throttle");
      const key = blockKey({ email: USER }, throttleHmacKey(process.env.BETTER_AUTH_SECRET ?? ""));

      await blockBucket(await getAuthPool(), key, 60);
      expect((await signIn("user")).response.status).toBe(429);

      await unblockBucket(await getAuthPool(), key);
      expect((await signIn("user")).response.status).toBe(200);
    });
  });

  // The role guard must sit in front of Better Auth's own pool (issue #44), not
  // only in front of the application ORM.
  it("refuses Better Auth when DATABASE_AUTH_URL reaches a role that skips row policies", async () => {
    const authUrl = process.env.DATABASE_AUTH_URL;

    await closeAuth();
    process.env.DATABASE_AUTH_URL = db.adminUrl;
    try {
      const { findSeededDemoAccounts } =
        await import("@/features/identity/infrastructure/demo-accounts");

      await expect(findSeededDemoAccounts()).rejects.toMatchObject({
        name: "UnsafeDatabaseRoleError",
      });

      const response = await login(jsonLogin("user@demo.krajozbior.local", PASSWORD));

      expect(response.status).toBe(503);
      expect(response.headers.getSetCookie()).toEqual([]);
    } finally {
      await closeAuth();
      process.env.DATABASE_AUTH_URL = authUrl;
    }

    expect((await signIn("user")).cookie).not.toBe("");
  });
});
