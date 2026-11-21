import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase, type ScratchDatabase } from "../support/database-harness";

// The sign-in code through the Brevo transport (EMAIL_TRANSPORT=brevo), with
// Better Auth on its own scratch database as krajozbior_auth. Brevo itself is a
// fake `fetch`: no test reaches the network (D-E11-9).
//
// OPS-7: when Brevo fails, the answer to a code request is the same for a new
// address, an existing account and an admin address (which never sends), and
// no log line holds an address or a code.
const PASSWORD = "integration-only-password";
const KEY = "xkeysib-integration-only-0123456789abcdef";

type Auth = Awaited<ReturnType<typeof importAuth>>["auth"];

let db: ScratchDatabase;
let auth: Auth;
let closeAuth: () => Promise<void>;
let brevo: ReturnType<typeof vi.fn<typeof fetch>>;
let logs: unknown[][];

async function importAuth() {
  const betterAuth = await import("@/features/identity/infrastructure/better-auth");

  return { auth: betterAuth.getAuth(), closeAuth: betterAuth.closeAuth };
}

const requestCode = (email: string) =>
  auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });

const sentBodies = () =>
  brevo.mock.calls.map(
    ([, init]) =>
      JSON.parse(String(init?.body)) as { to: { email: string }[]; textContent: string },
  );

describe("sign-in code through Brevo (fake fetch)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_brevo");
    await db.migrate();

    process.env.DATABASE_URL = db.urls.krajozbior_app;
    process.env.DATABASE_AUTH_URL = db.urls.krajozbior_auth;
    process.env.BETTER_AUTH_SECRET = "integration-only-secret-0123456789abcdef";
    process.env.EMAIL_TRANSPORT = "brevo";
    process.env.BREVO_API_KEY = KEY;
    process.env.EMAIL_FROM = "noreply@krajozbior.example";
    delete process.env.BETTER_AUTH_URL;

    brevo = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", brevo);

    const email = await import("@/lib/email/create-email-sender");
    email.resetEmailSenderForTests();

    ({ auth, closeAuth } = await importAuth());

    const { seedDemoAccounts } = await import("@/features/identity/infrastructure/demo-accounts");
    const { opsRoleAssigner } = await import("@/features/identity/infrastructure/user-role");
    await seedDemoAccounts(PASSWORD, opsRoleAssigner(db.urls.krajozbior_ops));
  }, 60_000);

  beforeEach(() => {
    brevo.mockReset();
    logs = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      });
    }
  });

  afterEach(() => {
    // Only the console spies; the fake fetch stays until the end of the file.
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await closeAuth?.();
    await db?.drop();
    for (const name of ["EMAIL_TRANSPORT", "BREVO_API_KEY", "EMAIL_FROM"]) delete process.env[name];
    const email = await import("@/lib/email/create-email-sender");
    email.resetEmailSenderForTests();
  });

  it("delivers the code to Brevo for a new address", async () => {
    brevo.mockImplementation(
      async () => new Response(JSON.stringify({ messageId: "<id@relay>" }), { status: 201 }),
    );
    const address = "nowa-przez-brevo@example.com";

    await requestCode(address);

    await vi.waitFor(() => expect(brevo).toHaveBeenCalledTimes(1));
    const [body] = sentBodies();
    expect(body!.to).toEqual([{ email: address }]);
    const code = body!.textContent.match(/\b\d{6}\b/)?.[0];
    expect(code).toBeDefined();
    expect(brevo.mock.calls[0]![1]?.headers).toMatchObject({ "api-key": KEY });
    expect(JSON.stringify(logs)).not.toContain(address);
    expect(JSON.stringify(logs)).not.toContain(code!);
  });

  it("answers the same for a new address, an account and an admin when Brevo is down", async () => {
    // A fresh answer per call: a Response body can be read only once.
    brevo.mockImplementation(async () => new Response("{}", { status: 503 }));
    const addresses = [
      "nikt-taki@example.com",
      "user@demo.krajozbior.local",
      "admin@demo.krajozbior.local",
    ];

    const answers = [];
    for (const address of addresses) answers.push(await requestCode(address));

    expect(answers).toEqual([answers[0], answers[0], answers[0]]);
    // The two non-admin requests each tried twice (one retry); the admin none.
    await vi.waitFor(() => expect(brevo).toHaveBeenCalledTimes(4), { timeout: 10_000 });
    expect(sentBodies().map((body) => body.to[0]!.email)).not.toContain(
      "admin@demo.krajozbior.local",
    );
    const failed = JSON.stringify({ event: "email.send_failed", reason: "brevo_unavailable" });
    await vi.waitFor(() => expect(logs.filter(([line]) => line === failed)).toHaveLength(2));
    const written = JSON.stringify(logs);
    for (const address of addresses) expect(written).not.toContain(address);
    for (const body of sentBodies()) {
      expect(written).not.toContain(body.textContent.match(/\b\d{6}\b/)![0]);
    }
  });

  it("logs brevo_rejected with the status when Brevo refuses the key, with no retry", async () => {
    brevo.mockImplementation(async () => new Response("{}", { status: 401 }));

    await requestCode("odmowa-klucza@example.com");

    await vi.waitFor(() =>
      expect(logs).toContainEqual([JSON.stringify({ event: "email.brevo_rejected", status: 401 })]),
    );
    expect(brevo).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logs)).not.toContain("odmowa-klucza");
  });
});
