import { symmetricEncrypt } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryEmailSender } from "@/lib/email/memory-email-sender";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// The schema of accounts, the Better Auth hooks and the sign-in code. Better
// Auth connects as starter_auth, like in production; the superuser connection
// (`adminUrl`) only reads what the code wrote.
const PASSWORD = "integration-only-password";
const permissionDenied = { code: "42501" };

type Auth = Awaited<ReturnType<typeof importAuth>>["auth"];

let db: ScratchDatabase;
let auth: Auth;
let mail: MemoryEmailSender;
let closeAuth: () => Promise<void>;
let accounts: Record<string, string>;

async function importAuth() {
  const betterAuth = await import("@/features/identity/infrastructure/better-auth");

  return { auth: betterAuth.getAuth(), closeAuth: betterAuth.closeAuth };
}

const admin$ = <T>(sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql, params)).rows as T[]);
const as$ = (
  role: "starter_app" | "starter_auth" | "starter_ops",
  sql: string,
  params: unknown[] = [],
) => withClient(db.urls[role], (client) => client.query(sql, params));

const sessionsOf = async (userId: string) =>
  (
    await admin$<{ n: number }>(`select count(*)::int as n from auth.sessions where user_id = $1`, [
      userId,
    ])
  )[0]!.n;

async function requestCode(email: string) {
  await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
}

async function codeSentTo(email: string): Promise<string> {
  return vi.waitFor(() => {
    const message = mail.lastTo(email);
    const code = message?.text.match(/\b\d{6}\b/)?.[0];
    if (code === undefined) throw new Error("no code yet");
    return code;
  });
}

const signInWithCode = (body: Record<string, unknown>) =>
  auth.api.signInEmailOTP({ body: body as { email: string; otp: string }, asResponse: true });

async function passwordSignIn(email: string) {
  const response = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  });
  expect(response.status).toBe(200);
}

async function storeCode(email: string, code: string) {
  const context = await auth.$context;
  const value = await symmetricEncrypt({ key: context.secretConfig, data: code });

  await admin$(
    `insert into auth.verifications (identifier, value, expires_at)
     values ($1, $2, now() + interval '10 minutes')`,
    [`sign-in-otp-${email}`, `${value}:0`],
  );
}

describe("accounts: schema, Better Auth hooks and sign-in code", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("starter_integration_auth_accounts");
    await db.migrate();

    process.env.DATABASE_URL = db.urls.starter_app;
    process.env.DATABASE_AUTH_URL = db.urls.starter_auth;
    process.env.BETTER_AUTH_SECRET = "integration-only-secret-0123456789abcdef";
    process.env.EMAIL_TRANSPORT = "memory";
    delete process.env.BETTER_AUTH_URL;

    const email = await import("@/lib/email/create-email-sender");
    email.resetEmailSenderForTests();
    mail = email.getMemoryEmailSender();

    ({ auth, closeAuth } = await importAuth());

    const { seedDemoAccounts } = await import("@/features/identity/infrastructure/demo-accounts");
    const { ownerRoleAssigner } = await import("@/features/identity/infrastructure/user-role");
    const seeded = await seedDemoAccounts(PASSWORD, ownerRoleAssigner(db.urls.starter_owner));
    accounts = Object.fromEntries(seeded.map((account) => [account.email, account.id]));
  }, 60_000);

  beforeEach(() => {
    mail.clear();
  });

  afterAll(async () => {
    await closeAuth?.();
    await db?.drop();
    delete process.env.EMAIL_TRANSPORT;
  });

  describe("schema", () => {
    it("lets starter_auth insert an account only without a role: it always becomes a user", async () => {
      await expect(
        as$(
          "starter_auth",
          `insert into auth.users (name, email, role) values ('x', 'admin-by-insert@example.com', 'admin')`,
        ),
      ).rejects.toMatchObject(permissionDenied);

      await as$(
        "starter_auth",
        `insert into auth.users (name, email) values ('x', 'plain-insert@example.com')`,
      );
      expect(
        await admin$<{ role: string }>(
          `select role from auth.users where email = 'plain-insert@example.com'`,
        ),
      ).toEqual([{ role: "user" }]);
      await admin$(`delete from auth.users where email = 'plain-insert@example.com'`);
    });

    it("sets another role only through starter_owner (operator script), never starter_auth", async () => {
      const { ownerRoleAssigner, setUserRole } =
        await import("@/features/identity/infrastructure/user-role");
      const email = "user2@demo.starter.local";

      await expect(
        withClient(db.urls.starter_auth, (client) => setUserRole(client, email, "admin")),
      ).rejects.toMatchObject(permissionDenied);

      await ownerRoleAssigner(db.urls.starter_owner)(email, "admin");
      expect(await admin$(`select role from auth.users where email = $1`, [email])).toEqual([
        { role: "admin" },
      ]);
      await ownerRoleAssigner(db.urls.starter_owner)(email, "user");
      expect(await admin$(`select role from auth.users where email = $1`, [email])).toEqual([
        { role: "user" },
      ]);
      await expect(
        ownerRoleAssigner(db.urls.starter_owner)("nobody@example.com", "admin"),
      ).rejects.toThrow("No account");
    });

    it("gives starter_app and starter_ops nothing in auth, starter_auth no update of role", async () => {
      for (const role of ["starter_app", "starter_ops"] as const) {
        for (const table of [
          "users",
          "sessions",
          "accounts",
          "verifications",
          "sign_in_throttle",
          "otp_send_counters",
        ]) {
          await expect(as$(role, `select * from auth.${table}`)).rejects.toMatchObject(
            permissionDenied,
          );
        }
      }

      await expect(
        as$("starter_auth", `update auth.users set role = 'admin' where id = $1`, [
          accounts["user@demo.starter.local"],
        ]),
      ).rejects.toMatchObject(permissionDenied);
    });

    it("refuses a role outside the roles of the starter", async () => {
      await expect(
        admin$(`update auth.users set role = 'root' where email like 'user@%'`),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("sign-in code", () => {
    it("refuses a role in the body and creates nothing", async () => {
      const email = "rola-w-tresci@example.com";

      await requestCode(email);
      const response = await signInWithCode({ email, otp: await codeSentTo(email), role: "admin" });

      expect(response.status).toBe(400);
      expect(await admin$(`select role from auth.users where email = $1`, [email])).toEqual([]);
    });

    it("creates only a user with a verified address", async () => {
      const email = "nowa-osoba@example.com";

      await requestCode(email);
      const response = await signInWithCode({ email, otp: await codeSentTo(email) });

      expect(response.status).toBe(200);
      const [user] = await admin$<{ role: string; verified: boolean }>(
        `select role, email_verified as verified from auth.users where email = $1`,
        [email],
      );
      expect(user).toEqual({ role: "user", verified: true });
      // The client address is not stored.
      expect(
        await admin$(
          `select s.ip_address as ip from auth.sessions s join auth.users u on u.id = s.user_id
            where u.email = $1`,
          [email],
        ),
      ).toEqual([{ ip: "" }]);
    });

    it("ignores an image address and the name sent by the client", async () => {
      const email = "obraz-i-nazwa@example.com";

      await requestCode(email);
      const response = await signInWithCode({
        email,
        otp: await codeSentTo(email),
        image: "https://tracker.example/pixel.png",
        name: "Jan Kowalski",
      });

      expect(response.status).toBe(200);
      expect(await admin$(`select name, image from auth.users where email = $1`, [email])).toEqual([
        { name: "", image: null },
      ]);
    });

    it("refuses a staff session by code even with a valid code stored directly", async () => {
      const email = "admin@demo.starter.local";

      await storeCode(email, "246810");
      const before = await sessionsOf(accounts[email]!);

      const response = await signInWithCode({ email, otp: "246810" });

      expect(response.status).toBe(403);
      expect(response.headers.getSetCookie().join()).not.toContain("session_token=");
      expect(await sessionsOf(accounts[email]!)).toBe(before);
    });

    it("sends no code to a staff address", async () => {
      const user = "user2@demo.starter.local";

      await requestCode("admin@demo.starter.local");
      await requestCode(user);
      // The user's message proves the callback ran; nothing went to the admin.
      await codeSentTo(user);
      expect(mail.lastTo("admin@demo.starter.local")).toBeUndefined();
      expect(mail.all()).toHaveLength(1);
    });
  });

  describe("sessions by role", () => {
    it("limits an admin password session to 12 hours from its creation", async () => {
      await passwordSignIn("admin@demo.starter.local");

      const [row] = await admin$<{ within: boolean }>(
        `select bool_and(expires_at <= created_at + interval '12 hours') as within
           from auth.sessions where user_id = $1`,
        [accounts["admin@demo.starter.local"]],
      );
      expect(row).toEqual({ within: true });
    });

    it("limits a user session to 30 days from its creation", async () => {
      await passwordSignIn("user@demo.starter.local");

      const [row] = await admin$<{ within: boolean }>(
        `select bool_and(expires_at <= created_at + interval '30 days') as within
           from auth.sessions where user_id = $1`,
        [accounts["user@demo.starter.local"]],
      );
      expect(row).toEqual({ within: true });
    });
  });
});
