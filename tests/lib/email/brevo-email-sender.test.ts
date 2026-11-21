import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BREVO_ENDPOINT,
  BrevoEmailSender,
  type BrevoEmailSenderOptions,
} from "@/lib/email/brevo-email-sender";
import type { EmailMessage } from "@/lib/email/email-sender";
import { renderSignInCodeEmail } from "@/lib/email/sign-in-code-email";

// Brevo is never called: every test hands the sender a fake `fetch` (D-E11-9).
const API_KEY = "xkeysib-test-only-0123456789abcdef";
const TO = "jan.kowalski@example.com";
const CODE = "482915";
const message: EmailMessage = {
  to: TO,
  tag: "sign_in_code",
  ...renderSignInCodeEmail({ code: CODE, siteUrl: "https://krajozbior.example" }),
};

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function sender(fetchMock: FetchMock, options: Partial<BrevoEmailSenderOptions> = {}) {
  return new BrevoEmailSender({
    apiKey: API_KEY,
    from: "noreply@krajozbior.example",
    fetch: fetchMock,
    retryDelayMs: 0,
    ...options,
  });
}

let logs: unknown[][];

beforeEach(() => {
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
  }
});

afterEach(() => {
  // Neither the recipient nor the code (nor the key) ever reaches a log line.
  const written = JSON.stringify(logs);
  expect(written).not.toContain(TO);
  expect(written).not.toContain("jan.kowalski");
  expect(written).not.toContain(CODE);
  expect(written).not.toContain(API_KEY);
  vi.restoreAllMocks();
});

const events = () => logs.map((args) => JSON.parse(String(args[0])) as Record<string, unknown>);

describe("BrevoEmailSender", () => {
  it("posts one JSON message to the Brevo API and returns its message id", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json(201, { messageId: "<202611211200.123@smtp-relay.mailin.fr>" }),
    );

    await expect(sender(fetchMock).send(message)).resolves.toEqual({
      ok: true,
      providerMessageId: "<202611211200.123@smtp-relay.mailin.fr>",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(BREVO_ENDPOINT);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toEqual({
      accept: "application/json",
      "content-type": "application/json",
      "api-key": API_KEY,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      sender: { email: "noreply@krajozbior.example", name: "Krajozbiór" },
      to: [{ email: TO }],
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html,
      tags: ["sign_in_code"],
    });
    expect(logs).toEqual([]);
  });

  it("counts a 2xx answer without a readable message id as sent", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("not json", { status: 201 }));

    await expect(sender(fetchMock).send(message)).resolves.toEqual({ ok: true });
  });

  it.each([401, 403, 429])(
    "logs brevo_rejected with the status %i and does not retry",
    async (status) => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        json(status, { code: "unauthorized", message: `Key not found for ${TO}` }),
      );

      await expect(sender(fetchMock).send(message)).resolves.toEqual({
        ok: false,
        retryable: false,
        reason: "brevo_rejected",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(events()).toEqual([{ event: "email.brevo_rejected", status }]);
    },
  );

  it("does not retry another 4xx answer and logs only its status", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json(400, { code: "invalid_parameter", message: `email ${TO} is not valid` }),
    );

    await expect(sender(fetchMock).send(message)).resolves.toEqual({
      ok: false,
      retryable: false,
      reason: "brevo_refused",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([{ event: "email.brevo_refused", status: 400 }]);
  });

  it("retries a 5xx answer once and succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(502))
      .mockResolvedValueOnce(json(201, { messageId: "<id@relay>" }));

    await expect(sender(fetchMock).send(message)).resolves.toEqual({
      ok: true,
      providerMessageId: "<id@relay>",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events()).toEqual([{ event: "email.brevo_retry", status: 502 }]);
  });

  it("gives up after one retry of a 5xx answer, as a retryable failure", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(503));

    await expect(sender(fetchMock).send(message)).resolves.toEqual({
      ok: false,
      retryable: true,
      reason: "brevo_unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events()).toEqual([
      { event: "email.brevo_retry", status: 503 },
      { event: "email.brevo_failed", status: 503 },
    ]);
  });

  it("does not retry a 4xx answer that follows a 5xx retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(500))
      .mockResolvedValueOnce(json(401));

    await expect(sender(fetchMock).send(message)).resolves.toMatchObject({
      ok: false,
      reason: "brevo_rejected",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a request after the time limit and retries it once", async () => {
    // A fake Brevo that never answers; it only rejects when the request is aborted.
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );

    await expect(sender(fetchMock, { timeoutMs: 20 }).send(message)).resolves.toEqual({
      ok: false,
      retryable: true,
      reason: "brevo_unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events()).toEqual([
      { event: "email.brevo_retry", status: "timeout" },
      { event: "email.brevo_failed", status: "timeout" },
    ]);
  });

  it("waits ten seconds by default before it gives up on an answer", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetchMock = vi.fn<typeof fetch>((_url, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      });

      void sender(fetchMock).send(message);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a network error once, without logging the error's text", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError(`fetch failed for ${TO}`))
      .mockRejectedValueOnce(new TypeError(`fetch failed for ${TO}`));

    await expect(sender(fetchMock).send(message)).resolves.toEqual({
      ok: false,
      retryable: true,
      reason: "brevo_unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events()).toEqual([
      { event: "email.brevo_retry", status: "network" },
      { event: "email.brevo_failed", status: "network" },
    ]);
  });

  it("refuses an invalid recipient without calling Brevo", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      sender(fetchMock).send({ ...message, to: "a@b.c\r\nBcc: x@y.z" }),
    ).resolves.toEqual({ ok: false, retryable: false, reason: "invalid_recipient" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
