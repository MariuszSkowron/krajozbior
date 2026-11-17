export type EmailMessage = Readonly<{
  to: string;
  subject: string;
  text: string;
  html: string;
  // One value per kind of message; extend the union with each new kind.
  tag: "sign_in_code";
}>;

export type SendResult =
  { ok: true; providerMessageId?: string } | { ok: false; retryable: boolean; reason: string };

export interface EmailSender {
  /** Never throws on a provider or disk failure: the failure is the result. */
  send(message: EmailMessage): Promise<SendResult>;
}

// One plain address, no display name, no angle brackets. Printable ASCII only
// (0x21-0x7e): no whitespace, no control characters (CR/LF would allow header
// injection in the .eml file) and no non-ASCII letters (the To header is not
// encoded).
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const RECIPIENT_PARTS = /^[^<>@"(),:;[\]\\]+@[^<>@"(),:;[\]\\]+$/;

export function isValidRecipient(address: string): boolean {
  return address.length <= 254 && PRINTABLE_ASCII.test(address) && RECIPIENT_PARTS.test(address);
}

export const INVALID_RECIPIENT: SendResult = {
  ok: false,
  retryable: false,
  reason: "invalid_recipient",
};
