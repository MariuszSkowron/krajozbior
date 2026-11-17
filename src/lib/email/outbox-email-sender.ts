import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { INVALID_RECIPIENT, isValidRecipient } from "./email-sender";
import type { EmailMessage, EmailSender, SendResult } from "./email-sender";
import { buildEml } from "./eml";

export type OutboxEmailSenderOptions = Readonly<{
  directory: string;
  from: string;
  fromName?: string;
  now?: () => Date;
}>;

/**
 * Writes each message as an .eml file, so the whole sign-in flow works without
 * a domain, a provider or the network. Local work and tests only; the
 * configuration refuses it on a shared or public deployment (A13).
 */
export class OutboxEmailSender implements EmailSender {
  private readonly now: () => Date;

  constructor(private readonly options: OutboxEmailSenderOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async send(message: EmailMessage): Promise<SendResult> {
    if (!isValidRecipient(message.to)) {
      return INVALID_RECIPIENT;
    }

    try {
      const date = this.now();
      // Random, not derived from the address: the id comes back as
      // providerMessageId and may reach logs.
      const id = randomBytes(8).toString("hex");
      const stamp = date.toISOString().replace(/[-:.]/g, "");
      const fileName = `${stamp}-${id}.eml`;
      const eml = buildEml(message, {
        from: this.options.from,
        fromName: this.options.fromName ?? "Starter",
        date,
        messageId: `${randomUUID()}@starter.local`,
        boundary: `starter-${randomUUID()}`,
      });

      // Owner-only access: the files hold fresh sign-in codes (no effect on Windows).
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(this.options.directory, fileName), eml, {
        flag: "wx",
        mode: 0o600,
      });

      return { ok: true, providerMessageId: id };
    } catch {
      // No path or address in the reason: it may reach logs.
      return { ok: false, retryable: true, reason: "outbox_write_failed" };
    }
  }
}
