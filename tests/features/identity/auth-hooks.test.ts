import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDatabaseHooks,
  createSendSignInCode,
  signInCodeDelivery,
} from "@/features/identity/infrastructure/auth-hooks";
import { MemoryEmailSender } from "@/lib/email/memory-email-sender";

// The Better Auth hooks on fake endpoint contexts; the real flow with the
// database is in tests/integration/auth-accounts-access.test.ts.
const now = new Date("2026-11-16T10:00:00.000Z");
const hours = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000);
const hooks = createDatabaseHooks({ now: () => now });

type AnyHook = (data: never, context: never) => Promise<unknown>;
const call = (hook: unknown, data: Record<string, unknown>, context: unknown) =>
  (hook as AnyHook)(data as never, context as never);

// A minimal stand-in for Better Auth's endpoint context (typed loosely on purpose).
function endpoint(role: string | null, path = "/sign-in/email-otp", session?: unknown): never {
  return {
    path,
    context: {
      session,
      internalAdapter: {
        findUserById: vi.fn(async () => (role === null ? null : { id: "u1", role })),
        findUserByEmail: vi.fn(async () => (role === null ? null : { user: { role } })),
      },
    },
  } as never;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("user.create.before", () => {
  const before = hooks.user!.create!.before;
  const user = { email: "a@example.com", emailVerified: true, role: "admin" };

  it("leaves trusted server provisioning (no endpoint context) unchanged", async () => {
    expect(await call(before, user, undefined)).toBeUndefined();
  });

  it("refuses an unverified address", async () => {
    await expect(call(before, { ...user, emailVerified: false }, endpoint(null))).rejects.toThrow(
      "email_not_verified",
    );
  });

  it("never writes a role (the database default `user` applies) and drops the image and the name", async () => {
    const result = (await call(
      before,
      { ...user, image: "https://tracker.example/pixel.png", name: "Jan Kowalski" },
      endpoint(null),
    )) as { data: Record<string, unknown> };

    expect(result.data).toEqual({ ...user, image: null, name: "", role: undefined });
    expect(result.data.role).toBeUndefined();
  });
});

describe("session.create.before", () => {
  const before = hooks.session!.create!.before;
  const session = { userId: "u1", createdAt: now, expiresAt: hours(24) };

  it("refuses a session without a request context", async () => {
    await expect(call(before, session, undefined)).rejects.toThrow("session_without_request");
  });

  it("refuses a staff session outside the password sign-in", async () => {
    await expect(call(before, session, endpoint("admin", "/sign-in/email-otp"))).rejects.toThrow(
      "staff_password_only",
    );
  });

  it("cuts a staff session to 12 hours", async () => {
    expect(await call(before, session, endpoint("admin", "/sign-in/email"))).toEqual({
      data: { ...session, expiresAt: hours(12) },
    });
  });

  it("refuses an account without a known role", async () => {
    await expect(call(before, session, endpoint(null))).rejects.toThrow("unknown_role");
  });

  it("keeps an user session within 30 days, counting from now when no creation time is given", async () => {
    const withoutCreation = { userId: "u1", expiresAt: hours(24) };

    expect(await call(before, withoutCreation, endpoint("user"))).toEqual({
      data: { ...withoutCreation, expiresAt: hours(24) },
    });
  });
});

describe("session.update.before", () => {
  const before = hooks.session!.update!.before;
  const current = (role: string) => ({ session: { createdAt: now }, user: { role } });

  it("leaves an update without a new expiry alone", async () => {
    expect(await call(before, { updatedAt: now }, undefined)).toBeUndefined();
  });

  it("refuses to extend a session it cannot attribute", async () => {
    expect(await call(before, { expiresAt: hours(1) }, undefined)).toBe(false);
    expect(await call(before, { expiresAt: hours(1) }, endpoint("user"))).toBe(false);
    expect(
      await call(before, { expiresAt: hours(1) }, endpoint("x", "/get-session", current("root"))),
    ).toBe(false);
  });

  it("never extends a session past its role's limit from creation", async () => {
    expect(
      await call(before, { expiresAt: hours(48) }, endpoint("x", "/get-session", current("admin"))),
    ).toEqual({ data: { expiresAt: hours(12) } });
    expect(
      await call(
        before,
        { expiresAt: hours(24 * 100) },
        endpoint("x", "/get-session", current("user")),
      ),
    ).toEqual({ data: { expiresAt: hours(24 * 30) } });
  });
});

describe("sendVerificationOTP callback", () => {
  function setup(sender = new MemoryEmailSender()) {
    const send = createSendSignInCode({
      emailSender: () => sender,
      siteUrl: () => "http://localhost:3000",
    });
    return { send, sender };
  }

  it("sends the sign-in code to a user or a new address, without waiting", async () => {
    const { send, sender } = setup();

    await send({ email: "a@example.com", otp: "123456", type: "sign-in" }, endpoint(null));

    // Preparing the message is off the answer's path: nothing is sent yet when
    // the callback has returned and the microtasks have run.
    expect(sender.lastTo("a@example.com")).toBeUndefined();
    await vi.waitFor(() => expect(sender.lastTo("a@example.com")?.text).toContain("123456"));
    expect(sender.lastTo("a@example.com")).toMatchObject({ tag: "sign_in_code" });
    expect(sender.lastTo("a@example.com")?.text).toContain("http://localhost:3000");
  });

  it("hands the message over unless the request context says deliver: false", async () => {
    const { send, sender } = setup();
    const data = { email: "a@example.com", otp: "123456", type: "sign-in" };

    await signInCodeDelivery.run({ deliver: false }, () => send(data, endpoint(null)));
    await signInCodeDelivery.run({ deliver: false }, () => send(data, endpoint("user")));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sender.all()).toEqual([]);

    await signInCodeDelivery.run({ deliver: true }, () => send(data, endpoint(null)));
    await vi.waitFor(() => expect(sender.lastTo("a@example.com")?.text).toContain("123456"));
  });

  it("looks the account up before skipping, as for every other request", async () => {
    const { send } = setup();
    const context = endpoint("user");

    await signInCodeDelivery.run({ deliver: false }, () =>
      send({ email: "a@example.com", otp: "123456", type: "sign-in" }, context),
    );

    const adapter = (
      context as unknown as { context: { internalAdapter: { findUserByEmail: unknown } } }
    ).context.internalAdapter;
    expect(adapter.findUserByEmail).toHaveBeenCalledOnce();
  });

  it("sends nothing to staff, for other code types or without a context", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { send, sender } = setup();

    await send({ email: "k@example.com", otp: "123456", type: "sign-in" }, endpoint("admin"));
    await send({ email: "a@example.com", otp: "123456", type: "forget-password" }, endpoint(null));
    await send({ email: "a@example.com", otp: "123456", type: "sign-in" }, undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sender.all()).toEqual([]);
    expect(info).toHaveBeenCalledWith(JSON.stringify({ event: "auth.otp_staff_skipped" }));
    expect(JSON.stringify(info.mock.calls)).not.toContain("k@example.com");
  });

  // OPS-7: an admin address never sends, so it can never fail. If the answer
  // waited for the provider, an outage (or the timing) would tell admin
  // addresses apart; so it returns at once, the same for every address.
  it("answers at once for every address, whatever the provider does", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hanging = { send: vi.fn(() => new Promise<never>(() => undefined)) };
    const failing = {
      send: vi.fn(async () => ({
        ok: false as const,
        retryable: true,
        reason: "brevo_unavailable",
      })),
    };
    const answers: unknown[] = [];

    for (const sender of [hanging, failing]) {
      const send = createSendSignInCode({
        emailSender: () => sender,
        siteUrl: () => "http://localhost:3000",
      });

      for (const role of [null, "user", "admin"] as const) {
        answers.push(
          await send({ email: "a@example.com", otp: "123456", type: "sign-in" }, endpoint(role)),
        );
      }
    }

    expect(answers).toEqual(Array(6).fill(undefined));
    // Only the non-admin requests reached the provider (after the answer).
    await vi.waitFor(() => expect(hanging.send).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(failing.send).toHaveBeenCalledTimes(2));
  });

  it("logs a failed or throwing send without the address or the code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = {
      send: vi.fn(async () => ({ ok: false as const, retryable: true, reason: "provider_down" })),
    };
    const throwing = {
      send: vi.fn(async () => Promise.reject(new TypeError("boom a@example.com"))),
    };

    for (const sender of [failing, throwing]) {
      const send = createSendSignInCode({
        emailSender: () => sender,
        siteUrl: () => "http://localhost:3000",
      });
      await send({ email: "a@example.com", otp: "654321", type: "sign-in" }, endpoint(null));
    }

    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ event: "email.send_failed", reason: "provider_down" }),
    );
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/a@example\.com|654321/);
  });

  it("adds no second log line for a refusal that the sender already logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rejected = {
      send: vi.fn(async () => ({ ok: false as const, retryable: false, reason: "brevo_rejected" })),
    };
    const send = createSendSignInCode({
      emailSender: () => rejected,
      siteUrl: () => "http://localhost:3000",
    });

    await send({ email: "a@example.com", otp: "654321", type: "sign-in" }, endpoint(null));

    await vi.waitFor(() => expect(rejected.send).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(error).not.toHaveBeenCalled();
  });
});
