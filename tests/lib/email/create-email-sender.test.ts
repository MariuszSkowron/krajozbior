import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createEmailSender,
  getEmailSender,
  getMemoryEmailSender,
  resetEmailSenderForTests,
} from "@/lib/email/create-email-sender";
import { MemoryEmailSender } from "@/lib/email/memory-email-sender";
import { OutboxEmailSender } from "@/lib/email/outbox-email-sender";

afterEach(() => {
  resetEmailSenderForTests();
  vi.unstubAllEnvs();
});

function useEnv(env: Record<string, string>) {
  vi.stubEnv("BETTER_AUTH_URL", "");
  vi.stubEnv("NODE_ENV", "test");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  // An empty BETTER_AUTH_URL is not "unset" for the parser, so remove it.
  if (!("BETTER_AUTH_URL" in env)) delete process.env.BETTER_AUTH_URL;
}

describe("createEmailSender", () => {
  it("returns the outbox adapter for EMAIL_TRANSPORT=outbox", () => {
    useEnv({ EMAIL_TRANSPORT: "outbox" });

    expect(createEmailSender()).toBeInstanceOf(OutboxEmailSender);
  });

  it("defaults to the outbox outside production", () => {
    useEnv({});
    delete process.env.EMAIL_TRANSPORT;

    expect(createEmailSender()).toBeInstanceOf(OutboxEmailSender);
  });

  it("returns one shared memory adapter for EMAIL_TRANSPORT=memory", () => {
    useEnv({ EMAIL_TRANSPORT: "memory" });

    expect(createEmailSender()).toBeInstanceOf(MemoryEmailSender);
    expect(createEmailSender()).toBe(createEmailSender());
  });
});

describe("getEmailSender", () => {
  it("creates the adapter once and keeps it until the test reset", () => {
    useEnv({ EMAIL_TRANSPORT: "outbox" });

    const first = getEmailSender();

    expect(getEmailSender()).toBe(first);

    resetEmailSenderForTests();

    expect(getEmailSender()).not.toBe(first);
  });
});

describe("getMemoryEmailSender", () => {
  it("exposes what was sent and forgets it on reset", async () => {
    useEnv({ EMAIL_TRANSPORT: "memory" });
    const message = {
      to: "jan@example.com",
      subject: "s",
      text: "t",
      html: "h",
      tag: "sign_in_code" as const,
    };

    await getEmailSender().send(message);

    expect(getMemoryEmailSender().lastTo("jan@example.com")?.subject).toBe("s");

    resetEmailSenderForTests();

    expect(getMemoryEmailSender().all()).toHaveLength(0);
  });

  it("throws when another transport is configured", () => {
    useEnv({ EMAIL_TRANSPORT: "outbox" });

    expect(() => getMemoryEmailSender()).toThrow("EMAIL_TRANSPORT=memory");
  });

  it("is refused by the configuration in a production build without the test flag", () => {
    useEnv({ EMAIL_TRANSPORT: "memory", NODE_ENV: "production", EMAIL_FROM: "a@starter.local" });

    expect(() => getMemoryEmailSender()).toThrow("Invalid server configuration");
  });
});
