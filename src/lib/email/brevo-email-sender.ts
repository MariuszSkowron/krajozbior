import { INVALID_RECIPIENT, isValidRecipient } from "./email-sender";
import type { EmailMessage, EmailSender, SendResult } from "./email-sender";

export const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
// The longest wait for one answer of Brevo (D-E11-9).
export const BREVO_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1_000;

// Brevo refuses our account, not the message: a wrong or revoked key (401), a
// suspended account or a server address outside the authorized list (403), the
// sending limit (429). Logged under this fixed name, which the hourly resource
// check counts and turns into an alarm e-mail (E11 5.7).
export const BREVO_REJECTED = "brevo_rejected";
const REJECTED_STATUSES = new Set([401, 403, 429]);

export type BrevoEmailSenderOptions = Readonly<{
  apiKey: string;
  from: string;
  fromName?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}>;

type Attempt =
  | { kind: "sent"; messageId?: string }
  | { kind: "rejected"; status: number }
  | { kind: "refused"; status: number }
  | { kind: "failed"; status: number | "timeout" | "network" };

// Only the status or the kind of failure reaches the log: never the address,
// the code, the request or Brevo's answer (which may repeat the address).
function logBrevo(event: string, status: number | string): void {
  console.error(JSON.stringify({ event, status }));
}

/**
 * Sends through the Brevo transactional e-mail API (D-E11-9), with `fetch` and
 * no SDK. A network error, a timeout or a 5xx answer is retried once; a 4xx
 * answer is never retried. Never throws: the failure is the result.
 */
export class BrevoEmailSender implements EmailSender {
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: BrevoEmailSenderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? BREVO_TIMEOUT_MS;
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    if (!isValidRecipient(message.to)) {
      return INVALID_RECIPIENT;
    }

    const body = JSON.stringify({
      sender: { email: this.options.from, name: this.options.fromName ?? "Krajozbiór" },
      to: [{ email: message.to }],
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html,
      tags: [message.tag],
    });

    let attempt = await this.attempt(body);

    if (attempt.kind === "failed") {
      logBrevo("email.brevo_retry", attempt.status);
      await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      attempt = await this.attempt(body);
    }

    switch (attempt.kind) {
      case "sent":
        return attempt.messageId === undefined
          ? { ok: true }
          : { ok: true, providerMessageId: attempt.messageId };
      case "rejected":
        logBrevo(`email.${BREVO_REJECTED}`, attempt.status);
        return { ok: false, retryable: false, reason: BREVO_REJECTED };
      case "refused":
        logBrevo("email.brevo_refused", attempt.status);
        return { ok: false, retryable: false, reason: "brevo_refused" };
      case "failed":
        logBrevo("email.brevo_failed", attempt.status);
        return { ok: false, retryable: true, reason: "brevo_unavailable" };
    }
  }

  private async attempt(body: string): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(BREVO_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": this.options.apiKey,
        },
        body,
        signal: controller.signal,
        redirect: "error",
      });

      if (response.ok) {
        return { kind: "sent", messageId: await readMessageId(response) };
      }
      if (REJECTED_STATUSES.has(response.status)) {
        return { kind: "rejected", status: response.status };
      }
      if (response.status < 500) {
        return { kind: "refused", status: response.status };
      }

      return { kind: "failed", status: response.status };
    } catch {
      return { kind: "failed", status: controller.signal.aborted ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
  }
}

// Brevo answers 201 with `{ "messageId": "<...@smtp-relay...>" }`; the id holds
// no address. A missing or malformed body still means the message was accepted.
async function readMessageId(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { messageId?: unknown };

    return typeof body.messageId === "string" && body.messageId.length <= 200
      ? body.messageId
      : undefined;
  } catch {
    return undefined;
  }
}
