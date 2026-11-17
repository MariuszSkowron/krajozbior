import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { EmailMessage, EmailSender } from "@/lib/email/email-sender";
import { MemoryEmailSender } from "@/lib/email/memory-email-sender";
import { OutboxEmailSender } from "@/lib/email/outbox-email-sender";
import { buildEml, encodeHeaderValue } from "@/lib/email/eml";
import { renderSignInCodeEmail } from "@/lib/email/sign-in-code-email";

const rendered = renderSignInCodeEmail({
  code: "123456",
  siteUrl: "https://krajozbior.example",
});
const message: EmailMessage = { to: "jan@example.com", tag: "sign_in_code", ...rendered };

const directories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "krajozbior-outbox-"));
  directories.push(directory);
  return directory;
}

afterAll(async () => {
  await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
});

const adapters: Array<[string, () => Promise<EmailSender>]> = [
  ["MemoryEmailSender", async () => new MemoryEmailSender()],
  [
    "OutboxEmailSender",
    async () =>
      new OutboxEmailSender({ directory: await tempDirectory(), from: "noreply@krajozbior.local" }),
  ],
];

describe.each(adapters)("EmailSender contract: %s", (_name, create) => {
  it("accepts a valid message", async () => {
    const sender = await create();

    await expect(sender.send(message)).resolves.toMatchObject({ ok: true });
  });

  it("returns a permanent failure instead of throwing for an invalid recipient", async () => {
    const sender = await create();

    for (const to of [
      "",
      "no-at-sign",
      "a@b.c\r\nBcc: x@y.z",
      "Jan <jan@example.com>",
      "a\0@b.c",
      "a@b.c\r",
      "a@b.c\n",
      "a\x7f@b.c",
      "zażółć@example.com",
      "jan@przykład.pl",
    ]) {
      await expect(sender.send({ ...message, to })).resolves.toEqual({
        ok: false,
        retryable: false,
        reason: "invalid_recipient",
      });
    }
  });
});

describe("MemoryEmailSender", () => {
  it("returns the latest message to an address, ignoring case", async () => {
    const sender = new MemoryEmailSender();

    await sender.send({ ...message, subject: "first" });
    await sender.send({ ...message, to: "inna@example.com", subject: "other" });
    await sender.send({ ...message, subject: "second" });

    expect(sender.lastTo("JAN@example.com")?.subject).toBe("second");
    expect(sender.lastTo("nikt@example.com")).toBeUndefined();
    expect(sender.all()).toHaveLength(3);

    sender.clear();
    expect(sender.all()).toHaveLength(0);
  });
});

describe("OutboxEmailSender", () => {
  it("writes one .eml per message with an RFC 2047 subject and decodable parts", async () => {
    const directory = await tempDirectory();
    const sender = new OutboxEmailSender({ directory, from: "noreply@krajozbior.local" });

    await sender.send(message);
    await sender.send(message);

    const files = await readdir(directory);
    expect(files).toHaveLength(2);
    expect(files.every((file) => /^\d{8}T\d{9}Z-[0-9a-f]{16}\.eml$/.test(file))).toBe(true);

    const eml = await readFile(path.join(directory, files[0]!), "utf8");
    const headers = eml.split("\r\n\r\n")[0]!;

    // The header block is pure ASCII; the Polish subject is in encoded words.
    expect(headers).toMatch(/^[\x00-\x7f]*$/);
    expect(headers).toContain("To: jan@example.com");
    expect(headers).toContain("X-App-Tag: sign_in_code");
    expect(headers).toContain(
      `From: ${encodeHeaderValue("Krajozbiór")} <noreply@krajozbior.local>`,
    );

    const subjectBlock = /^Subject: (.*(?:\r\n .*)*)/m.exec(headers)![1]!;
    const decoded = [...subjectBlock.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)]
      .map((match) => Buffer.from(match[1]!, "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe("123456 — kod logowania (Krajozbiór)");
    for (const word of subjectBlock.split(/\r\n /)) expect(word.length).toBeLessThanOrEqual(75);

    const bodies = [...eml.matchAll(/base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map((match) =>
      Buffer.from(match[1]!.replace(/\r\n/g, ""), "base64").toString("utf8"),
    );
    expect(bodies).toEqual([message.text, message.html]);
  });

  it("returns a retryable failure when the directory cannot be written", async () => {
    const sender = new OutboxEmailSender({
      directory: path.join(await tempDirectory(), "bad\0dir"),
      from: "noreply@krajozbior.local",
    });

    await expect(sender.send(message)).resolves.toEqual({
      ok: false,
      retryable: true,
      reason: "outbox_write_failed",
    });
  });
});

describe("OutboxEmailSender files", () => {
  it("returns a random id that does not depend on the address", async () => {
    const directory = await tempDirectory();
    const sender = new OutboxEmailSender({ directory, from: "noreply@krajozbior.local" });

    const first = await sender.send(message);
    const second = await sender.send(message);

    expect(first).toMatchObject({
      ok: true,
      providerMessageId: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    expect(second).toMatchObject({ ok: true });
    expect(first).not.toEqual(second);
    for (const file of await readdir(directory)) {
      expect(file).not.toContain("jan");
    }
  });

  it.skipIf(process.platform === "win32")("creates the directory 0700 and files 0600", async () => {
    const directory = path.join(await tempDirectory(), "nested", "outbox");
    const sender = new OutboxEmailSender({ directory, from: "noreply@krajozbior.local" });

    await sender.send(message);

    const [file] = await readdir(directory);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(directory, file!))).mode & 0o777).toBe(0o600);
  });
});

describe("encodeHeaderValue", () => {
  it("leaves printable ASCII untouched", () => {
    expect(encodeHeaderValue("Ala ma kota")).toBe("Ala ma kota");
  });

  it("splits a long multi-byte value into words of at most 75 characters", () => {
    const value = "ąęśż".repeat(25);
    const words = encodeHeaderValue(value).split("\r\n ");

    expect(words.length).toBeGreaterThan(1);
    for (const word of words) {
      expect(word.length).toBeLessThanOrEqual(75);
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    }
    const decoded = words
      .map((word) => Buffer.from(/\?B\?(.+)\?=/.exec(word)![1]!, "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe(value);
  });
});

describe("buildEml", () => {
  const options = {
    from: "noreply@krajozbior.local",
    fromName: "Krajozbiór",
    date: new Date("2026-11-15T10:20:30Z"),
    messageId: "id@krajozbior.local",
    boundary: "b",
  };

  it("strips CR/LF from the subject so it cannot add a header", () => {
    const eml = buildEml({ ...message, subject: "Temat\r\nBcc: x@y.z" }, options);
    const headers = eml.split("\r\n\r\n")[0]!;

    expect(headers).not.toMatch(/^Bcc:/m);
    expect(headers).toContain("Subject: Temat Bcc: x@y.z");
  });

  it("writes the Date header with a numeric zone", () => {
    expect(buildEml(message, options)).toContain("Date: Sun, 15 Nov 2026 10:20:30 +0000\r\n");
  });
});
