import "server-only";

import { getEmailEnv } from "@/lib/config/env";

import { BrevoEmailSender } from "./brevo-email-sender";
import type { EmailSender } from "./email-sender";
import { MemoryEmailSender } from "./memory-email-sender";
import { OutboxEmailSender } from "./outbox-email-sender";

let sender: EmailSender | undefined;
// One instance per process, so a test reads what the code under test sent.
const memorySender = new MemoryEmailSender();

export function createEmailSender(): EmailSender {
  const env = getEmailEnv();

  switch (env.EMAIL_TRANSPORT) {
    case "outbox":
      return new OutboxEmailSender({ directory: env.EMAIL_OUTBOX_DIR, from: env.EMAIL_FROM });
    case "memory":
      return memorySender;
    case "brevo":
      return new BrevoEmailSender({ apiKey: env.BREVO_API_KEY, from: env.EMAIL_FROM });
  }
}

// Created on first use, so `next build` needs no e-mail configuration.
export function getEmailSender(): EmailSender {
  sender ??= createEmailSender();
  return sender;
}

/**
 * For tests: the shared in-memory sender. Works only with EMAIL_TRANSPORT=memory,
 * which the configuration refuses in a production build without the test flag.
 */
export function getMemoryEmailSender(): MemoryEmailSender {
  const current = getEmailSender();
  if (current !== memorySender) {
    throw new Error("EMAIL_TRANSPORT=memory is required");
  }
  return memorySender;
}

/** For tests: forgets the cached adapter and the messages of the memory sender. */
export function resetEmailSenderForTests(): void {
  sender = undefined;
  memorySender.clear();
}
