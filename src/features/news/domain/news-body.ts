import { normalizeLineBreaks } from "@/features/catalog/domain/collection";

import { NEWS_BODY_MAX_LENGTH, NEWS_MAX_LINKS } from "./limits";

// The body of a news item is plain text: paragraphs of text and links, no HTML and
// no Markdown (spec E7, Q3, D-E7-3). `parseNewsBody` is the only place that decides
// what is a link. The same call counts links when a curator saves and when a reader
// views, so the rules of saving and of display cannot drift apart. The React component
// writes the fragments as text nodes (never `dangerouslySetInnerHTML`).

export type NewsBodyFragment =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{
      kind: "link";
      /** The normalized address; the host of an international domain is in the `xn--` form. */
      href: string;
      /** What the reader sees: the same address as `href`. */
      text: string;
      /** What the curator wrote, only when the host had letters outside ASCII (homograph warning). */
      original: string | null;
    }>;

/** One paragraph: fragments in order; single line breaks stay inside text fragments. */
export type NewsBodyParagraph = readonly NewsBodyFragment[];

export type NewsBodyError = "too_long" | "too_many_links" | "shortener" | "credentials";

export type NewsBodyResult =
  | Readonly<{ ok: true; paragraphs: readonly NewsBodyParagraph[]; linkCount: number }>
  | Readonly<{ ok: false; error: NewsBodyError }>;

/** The `rel` of every link in a news body (Q18). */
export const NEWS_LINK_REL = "nofollow ugc noopener noreferrer";

// Frozen list of address shorteners (Q18): they hide where a link leads. A domain
// matches itself and its subdomains.
export const NEWS_LINK_SHORTENERS: readonly string[] = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "cutt.ly",
  "rebrand.ly",
  "t.ly",
  "s.id",
];

// A candidate link: `https://` and then characters up to a space or one of `<>"`.
// A single character class under one quantifier, so matching is linear: no nested
// quantifiers, no backtracking blow-up (S3). The length of the input is capped first.
const LINK_CANDIDATE = /https:\/\/[^\s<>"]+/gi;

const TRAILING_PUNCTUATION = ".,;:!?'";

// `URL` keeps the trailing dot of a host (`bit.ly.` is the same site as `bit.ly`), so
// the dots are cut in a loop before any comparison (B1). A loop, not `/\.+$/`, which is
// quadratic on a long run of dots.
function withoutTrailingDots(hostname: string): string {
  let end = hostname.length;

  while (end > 0 && hostname[end - 1] === ".") {
    end -= 1;
  }

  return hostname.slice(0, end);
}

function isShortener(host: string): boolean {
  return NEWS_LINK_SHORTENERS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

const IPV4_HOST = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

// An address of a device (an IP number, in any notation `URL` normalizes) or of a
// host without a dot (`localhost`, a name in a local network) is not a link for
// a reader: it can point into the reader's own network (N1). It stays plain text.
function isLocalOrNumericHost(host: string): boolean {
  return host.startsWith("[") || !host.includes(".") || IPV4_HOST.test(host);
}

function hasNonAscii(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0x7f) {
      return true;
    }
  }

  return false;
}

function countOf(text: string, char: string): number {
  let count = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === char) {
      count += 1;
    }
  }

  return count;
}

// Punctuation that ends a sentence is not part of the address; a closing bracket
// is cut only when the address has no opening bracket for it.
function trimTrailing(raw: string): string {
  let end = raw.length;
  const opening = countOf(raw, "(");
  let closing = countOf(raw, ")");

  while (end > 0) {
    const last = raw[end - 1];

    if (TRAILING_PUNCTUATION.includes(last)) {
      end -= 1;
    } else if (last === ")" && closing > opening) {
      closing -= 1;
      end -= 1;
    } else {
      break;
    }
  }

  return raw.slice(0, end);
}

function hostPart(address: string): string {
  const rest = address.slice("https://".length);
  const stop = rest.search(/[/?#]/);

  return stop === -1 ? rest : rest.slice(0, stop);
}

type LinkAttempt =
  | Readonly<{ kind: "link"; fragment: NewsBodyFragment & { kind: "link" } }>
  | Readonly<{ kind: "text" }>
  | Readonly<{ kind: "error"; error: "shortener" | "credentials" }>;

function toLink(candidate: string): LinkAttempt {
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    return { kind: "text" };
  }

  if (url.username !== "" || url.password !== "") {
    return { kind: "error", error: "credentials" };
  }

  const host = withoutTrailingDots(url.hostname);

  if (isShortener(host)) {
    return { kind: "error", error: "shortener" };
  }

  if (isLocalOrNumericHost(host)) {
    return { kind: "text" };
  }

  return {
    kind: "link",
    fragment: {
      kind: "link",
      href: url.href,
      text: url.href,
      original: hasNonAscii(hostPart(candidate)) ? candidate : null,
    },
  };
}

type ParagraphResult =
  | Readonly<{ ok: true; fragments: NewsBodyFragment[]; linkCount: number }>
  | Readonly<{ ok: false; error: "shortener" | "credentials" }>;

function parseParagraph(paragraph: string): ParagraphResult {
  const fragments: NewsBodyFragment[] = [];
  let linkCount = 0;
  let cursor = 0;

  for (const match of paragraph.matchAll(LINK_CANDIDATE)) {
    const candidate = trimTrailing(match[0]);
    const attempt = toLink(candidate);

    if (attempt.kind === "error") {
      return { ok: false, error: attempt.error };
    }

    if (attempt.kind === "text") {
      continue;
    }

    const before = paragraph.slice(cursor, match.index);

    if (before !== "") {
      fragments.push({ kind: "text", text: before });
    }

    fragments.push(attempt.fragment);
    linkCount += 1;
    cursor = match.index + candidate.length;
  }

  const rest = paragraph.slice(cursor);

  if (rest !== "") {
    fragments.push({ kind: "text", text: rest });
  }

  return { ok: true, fragments, linkCount };
}

// A blank line (empty or only spaces) starts a new paragraph; single line breaks stay.
function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  let lines: string[] = [];

  const flush = () => {
    if (lines.length > 0) {
      paragraphs.push(lines.join("\n").trim());
      lines = [];
    }
  };

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      flush();
    } else {
      lines.push(line);
    }
  }

  flush();

  return paragraphs;
}

/** Length in characters (code points), as the database counts them. */
export function codePointLength(text: string): number {
  return [...text].length;
}

/**
 * Splits a news body into paragraphs of text and `https://` links (D-E7-3, Q18).
 * Refuses (does not guess) a body longer than 5000 characters, with more than 5 links,
 * with an address from a shortener or with a name and password in an address. An
 * `http://` address, `javascript:` and everything else stay plain text.
 */
export function parseNewsBody(body: string): NewsBodyResult {
  // Cheap cut before any normalizing, counting or matching (N3): even if every
  // character were a two-unit one (or a CRLF), this much text is over the limit.
  if (body.length > NEWS_BODY_MAX_LENGTH * 2) {
    return { ok: false, error: "too_long" };
  }

  const text = normalizeLineBreaks(body);

  if (codePointLength(text) > NEWS_BODY_MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }

  const paragraphs: NewsBodyParagraph[] = [];
  let linkCount = 0;

  for (const paragraph of splitParagraphs(text)) {
    const parsed = parseParagraph(paragraph);

    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }

    linkCount += parsed.linkCount;
    paragraphs.push(parsed.fragments);
  }

  if (linkCount > NEWS_MAX_LINKS) {
    return { ok: false, error: "too_many_links" };
  }

  return { ok: true, paragraphs, linkCount };
}
