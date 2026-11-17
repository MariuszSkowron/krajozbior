import type { EmailMessage } from "./email-sender";

const CRLF = "\r\n";

function wrap(value: string, width: number): string[] {
  return value.match(new RegExp(`.{1,${width}}`, "g")) ?? [];
}

/** RFC 2047 encoded words (B encoding), split on character boundaries. */
export function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return value;
  }

  const words: string[] = [];
  let current = "";

  // 45 bytes encode to 60 characters, so a word stays under 75 with its wrapper.
  for (const char of value) {
    if (Buffer.byteLength(current + char) > 45) {
      words.push(current);
      current = "";
    }
    current += char;
  }
  if (current !== "") words.push(current);

  return words
    .map((word) => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`)
    .join(`${CRLF} `);
}

function base64Body(value: string): string {
  return wrap(Buffer.from(value, "utf8").toString("base64"), 76).join(CRLF);
}

export type EmlOptions = Readonly<{
  from: string;
  fromName: string;
  date: Date;
  messageId: string;
  boundary: string;
}>;

/** A multipart/alternative message (text, then HTML) with a UTF-8 subject. */
export function buildEml(message: EmailMessage, options: EmlOptions): string {
  const headers = [
    `From: ${encodeHeaderValue(options.fromName)} <${options.from}>`,
    `To: ${message.to}`,
    `Subject: ${encodeHeaderValue(message.subject.replace(/[\r\n]+/g, " "))}`,
    `Date: ${options.date.toUTCString().replace(/ GMT$/, " +0000")}`,
    `Message-ID: <${options.messageId}>`,
    `X-App-Tag: ${message.tag}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${options.boundary}"`,
  ];

  const part = (type: string, body: string) =>
    [
      `--${options.boundary}`,
      `Content-Type: ${type}; charset=utf-8`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Body(body),
    ].join(CRLF);

  return [
    headers.join(CRLF),
    "",
    part("text/plain", message.text),
    part("text/html", message.html),
    `--${options.boundary}--`,
    "",
  ].join(CRLF);
}
