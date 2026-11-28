import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// POST /api/auth/code/request on its own scratch database with the real limiter,
// the real Better Auth and the in-memory mail sender: the answer must not reveal
// whether an address has an account, in any state of the daily pools (D-61 pt 1).
// Only the message differs: it goes out exactly when the limiter says so, which
// also proves that the `deliver` flag reaches the sendVerificationOTP callback.
const GLOBAL = 10;
const NEW = 4; // the accounts pool is the rest: 6

let db: ScratchDatabase;
let mail: ReturnType<typeof import("@/lib/email/create-email-sender").getMemoryEmailSender>;
let closeAuth: () => Promise<void>;
let POST: (request: Request) => Promise<Response>;
let counter = 0;

const admin$ = (sql: string, params: unknown[] = []) =>
  withClient(db.adminUrl, (client) => client.query(sql, params));

const setPool = (bucket: string, count: number) =>
  admin$(
    `insert into auth.otp_send_counters (bucket, day, count)
     values ($1, (now() at time zone 'utc')::date, $2)
     on conflict (bucket, day) do update set count = excluded.count`,
    [bucket, count],
  );

const storedCodes = async () =>
  ((await admin$("select count(*)::int as n from auth.verifications")).rows[0]?.n ?? 0) as number;

type Observed = {
  status: number;
  body: string;
  location: string | null;
  headers: [string, string][];
  cookieSet: boolean;
  codeStored: boolean;
  messageSent: boolean;
};

// One request for a fresh address, with or without an account, after `prepare`.
async function request(hasAccount: boolean, prepare: () => Promise<void>): Promise<Observed> {
  counter += 1;
  const email = `osoba${counter}@example.com`;

  if (hasAccount) {
    await admin$(`insert into auth.users (name, email) values ('x', $1)`, [email]);
  }
  await prepare();
  mail.clear();
  const before = await storedCodes();

  const response = await POST(
    new Request("http://localhost:3000/api/auth/code/request", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "localhost:3000" },
      body: new URLSearchParams({ email }),
      redirect: "manual",
    }),
  );
  // The hand-over is not awaited by the route; give it time to happen.
  await new Promise((resolve) => setTimeout(resolve, 150));

  return {
    status: response.status,
    body: await response.text(),
    location: response.headers.get("location"),
    headers: [...response.headers.entries()].filter(([name]) => name !== "set-cookie").sort(),
    cookieSet: response.headers.getSetCookie().length === 1,
    codeStored: (await storedCodes()) === before + 1,
    messageSent: mail.all().length === 1,
  };
}

// The observable answer, without the delivery flag.
const answer = (observed: Observed) => ({ ...observed, messageSent: undefined });

describe("POST /api/auth/code/request: no account oracle through the pools", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_otp_route");
    await db.migrate();

    process.env.DATABASE_URL = db.urls.krajozbior_app;
    process.env.DATABASE_AUTH_URL = db.urls.krajozbior_auth;
    process.env.BETTER_AUTH_SECRET = "integration-only-secret-0123456789abcdef";
    process.env.EMAIL_TRANSPORT = "memory";
    process.env.EMAIL_FROM = "noreply@krajozbior.example";
    process.env.OTP_GLOBAL_DAILY_LIMIT = String(GLOBAL);
    process.env.OTP_NEW_ACCOUNT_DAILY_LIMIT = String(NEW);
    delete process.env.BETTER_AUTH_URL;
    delete process.env.AUTH_CLIENT_IP_HEADER;

    const email = await import("@/lib/email/create-email-sender");
    email.resetEmailSenderForTests();
    mail = email.getMemoryEmailSender();
    ({ POST } = await import("@/app/api/auth/code/request/route"));
    ({ closeAuth } = await import("@/features/identity/infrastructure/better-auth"));
  }, 60_000);

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await admin$("truncate auth.sign_in_throttle, auth.otp_send_counters");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await closeAuth?.();
    await db?.drop();
    for (const name of [
      "EMAIL_TRANSPORT",
      "EMAIL_FROM",
      "OTP_GLOBAL_DAILY_LIMIT",
      "OTP_NEW_ACCOUNT_DAILY_LIMIT",
    ]) {
      delete process.env[name];
    }
  });

  const states: [string, () => Promise<void>, { account: boolean; fresh: boolean }][] = [
    ["both pools have room", async () => undefined, { account: true, fresh: true }],
    [
      "the pool of new addresses is full",
      async () => void (await setPool("new_accounts", NEW)),
      { account: true, fresh: false },
    ],
    [
      "the pool of accounts is full",
      async () => void (await setPool("accounts", GLOBAL - NEW)),
      { account: false, fresh: true },
    ],
    [
      "both pools are full",
      async () => {
        await setPool("new_accounts", NEW);
        await setPool("accounts", GLOBAL - NEW);
      },
      { account: false, fresh: false },
    ],
  ];

  it.each(states)(
    "answers the same for an account and a new address when %s",
    async (_name, prepare, expected) => {
      const account = await request(true, prepare);
      const fresh = await request(false, prepare);

      expect(account.status).toBe(303);
      expect(answer(account)).toEqual(answer(fresh));
      // The code is created and stored in every case, as the same work.
      expect(account.codeStored).toBe(true);
      expect(fresh.codeStored).toBe(true);
      expect(account.cookieSet).toBe(true);
      // The message goes out only where the limiter allows it.
      expect(account.messageSent).toBe(expected.account);
      expect(fresh.messageSent).toBe(expected.fresh);
    },
  );

  it("answers 429 with the same body for an account and a new address at the address limit", async () => {
    const prepare = async () => undefined;
    const hit = async (hasAccount: boolean) => {
      counter += 1;
      const email = `limit${counter}@example.com`;
      if (hasAccount)
        await admin$(`insert into auth.users (name, email) values ('x', $1)`, [email]);
      let last: Response | undefined;
      await prepare();
      for (let i = 0; i < 6; i += 1) {
        last = await POST(
          new Request("http://localhost:3000/api/auth/code/request", {
            method: "POST",
            headers: { "content-type": "application/json", host: "localhost:3000" },
            body: JSON.stringify({ email }),
          }),
        );
      }

      return { status: last!.status, body: await last!.text() };
    };

    const account = await hit(true);
    const fresh = await hit(false);

    expect(account.status).toBe(429);
    expect(account).toEqual(fresh);
  });

  it("answers the same after a probe at one below the full pool, whether or not the probed address has an account", async () => {
    // Each pool at limit - 1: request X (account or not), then a fresh address.
    for (const bucket of ["new_accounts", "accounts"] as const) {
      const outcome = async (probedHasAccount: boolean) => {
        await admin$("truncate auth.sign_in_throttle, auth.otp_send_counters");
        await setPool(bucket, (bucket === "accounts" ? GLOBAL - NEW : NEW) - 1);
        const probe = await request(probedHasAccount, async () => undefined);
        const next = await request(false, async () => undefined);

        // Only the HTTP answers are compared: whether the next message goes out
        // is visible only in the prober's own mailbox (accepted residual risk).
        return { probe: answer(probe), next: answer(next) };
      };

      expect(await outcome(true)).toEqual(await outcome(false));
    }
  });
});
