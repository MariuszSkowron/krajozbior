import { INVALID_RECIPIENT, isValidRecipient } from "./email-sender";
import type { EmailMessage, EmailSender, SendResult } from "./email-sender";

/** Keeps messages in memory for unit and integration tests. */
export class MemoryEmailSender implements EmailSender {
  private readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<SendResult> {
    if (!isValidRecipient(message.to)) {
      return INVALID_RECIPIENT;
    }

    this.sent.push(message);
    return { ok: true, providerMessageId: `memory-${this.sent.length}` };
  }

  all(): readonly EmailMessage[] {
    return [...this.sent];
  }

  /** The most recent message to the address (case-insensitive), if any. */
  lastTo(address: string): EmailMessage | undefined {
    const wanted = address.toLowerCase();
    return this.sent.findLast((message) => message.to.toLowerCase() === wanted);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
