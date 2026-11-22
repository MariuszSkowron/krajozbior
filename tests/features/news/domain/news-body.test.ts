import { describe, expect, it } from "vitest";

import { NEWS_BODY_MAX_LENGTH, NEWS_MAX_LINKS } from "@/features/news/domain/limits";
import {
  NEWS_LINK_REL,
  NEWS_LINK_SHORTENERS,
  parseNewsBody,
  type NewsBodyFragment,
} from "@/features/news/domain/news-body";

function ok(body: string) {
  const result = parseNewsBody(body);

  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error}`);
  }

  return result;
}

const link = (href: string, original: string | null = null): NewsBodyFragment => ({
  kind: "link",
  href,
  text: href,
  original,
});

describe("parseNewsBody: paragraphs", () => {
  it("returns no paragraphs for an empty or blank body", () => {
    expect(ok("").paragraphs).toEqual([]);
    expect(ok("  \n \n\n").paragraphs).toEqual([]);
  });

  it("starts a paragraph at a blank line and keeps single line breaks", () => {
    const { paragraphs } = ok("Pierwsza\nlinia\n\n  \nDruga");

    expect(paragraphs).toEqual([
      [{ kind: "text", text: "Pierwsza\nlinia" }],
      [{ kind: "text", text: "Druga" }],
    ]);
  });

  it("normalizes CRLF and CR to LF", () => {
    expect(ok("A\r\n\r\nB\rC").paragraphs).toEqual([
      [{ kind: "text", text: "A" }],
      [{ kind: "text", text: "B\nC" }],
    ]);
  });

  it("trims the edges of a paragraph", () => {
    expect(ok("   Tekst   ").paragraphs).toEqual([[{ kind: "text", text: "Tekst" }]]);
  });
});

describe("parseNewsBody: links", () => {
  it("turns an https address into a link with text equal to the address", () => {
    const result = ok("Bilety: https://example.org/bilety teraz");

    expect(result.linkCount).toBe(1);
    expect(result.paragraphs).toEqual([
      [
        { kind: "text", text: "Bilety: " },
        link("https://example.org/bilety"),
        { kind: "text", text: " teraz" },
      ],
    ]);
  });

  it("writes the normalized address (a bare host gets a slash) and accepts a capital scheme", () => {
    expect(ok("HTTPS://Example.ORG").paragraphs).toEqual([[link("https://example.org/")]]);
  });

  it("allows a port, a query and a fragment", () => {
    expect(ok("https://example.org:8443/a?b=1#c").paragraphs).toEqual([
      [link("https://example.org:8443/a?b=1#c")],
    ]);
  });

  it("keeps http: as plain text, never a link", () => {
    const result = ok("http://example.org/x");

    expect(result.linkCount).toBe(0);
    expect(result.paragraphs).toEqual([[{ kind: "text", text: "http://example.org/x" }]]);
  });

  it("keeps javascript:, data: and HTML as plain text", () => {
    const body = "<script>alert(1)</script> <img src=x onerror=alert(1)> javascript:alert(1)";
    const result = ok(body);

    expect(result.linkCount).toBe(0);
    expect(result.paragraphs).toEqual([[{ kind: "text", text: body }]]);
  });

  it("does not link a scheme-less address", () => {
    expect(ok("www.example.org").paragraphs).toEqual([[{ kind: "text", text: "www.example.org" }]]);
  });

  it("keeps an address that cannot be parsed as text", () => {
    const result = ok("https://[::1 i https://:80");

    expect(result.linkCount).toBe(0);
    expect(result.paragraphs).toEqual([[{ kind: "text", text: "https://[::1 i https://:80" }]]);
  });

  it("keeps text before an unparsable candidate and a link after it", () => {
    expect(ok("a https://:80 b https://example.org").paragraphs).toEqual([
      [{ kind: "text", text: "a https://:80 b " }, link("https://example.org/")],
    ]);
  });

  it("finds links in several paragraphs and counts them", () => {
    const result = ok("https://a.example\n\nhttps://b.example i https://c.example");

    expect(result.linkCount).toBe(3);
    expect(result.paragraphs).toHaveLength(2);
  });

  it("cuts trailing punctuation off the address", () => {
    expect(ok("Zobacz https://example.org/a.").paragraphs).toEqual([
      [
        { kind: "text", text: "Zobacz " },
        link("https://example.org/a"),
        { kind: "text", text: "." },
      ],
    ]);
    expect(ok("https://example.org/a,").paragraphs[0][0]).toEqual(link("https://example.org/a"));
    expect(ok("https://example.org/a?!;:'").paragraphs[0][0]).toEqual(
      link("https://example.org/a"),
    );
  });

  it("cuts a closing bracket without an opening one, but keeps a balanced one", () => {
    expect(ok("(zob. https://example.org/a)").paragraphs).toEqual([
      [
        { kind: "text", text: "(zob. " },
        link("https://example.org/a"),
        { kind: "text", text: ")" },
      ],
    ]);
    expect(ok("https://example.org/a_(b)").paragraphs).toEqual([
      [link("https://example.org/a_(b)")],
    ]);
    expect(ok("https://example.org/a_(b))").paragraphs).toEqual([
      [link("https://example.org/a_(b)"), { kind: "text", text: ")" }],
    ]);
    expect(ok("https://example.org/a.)").paragraphs[0][0]).toEqual(link("https://example.org/a"));
  });

  it("stops a candidate at a quote or an angle bracket", () => {
    expect(ok('"https://example.org/a" <https://example.org/b>').paragraphs).toEqual([
      [
        { kind: "text", text: '"' },
        link("https://example.org/a"),
        { kind: "text", text: '" <' },
        link("https://example.org/b"),
        { kind: "text", text: ">" },
      ],
    ]);
  });

  it("handles an address made only of punctuation after the scheme", () => {
    const result = ok("https://...");

    expect(result.linkCount).toBe(0);
  });

  it("accepts exactly 5 links and refuses the 6th", () => {
    const five = Array.from({ length: NEWS_MAX_LINKS }, (_, i) => `https://s${i}.example`).join(
      " ",
    );

    expect(ok(five).linkCount).toBe(NEWS_MAX_LINKS);
    expect(parseNewsBody(`${five} https://s9.example`)).toEqual({
      ok: false,
      error: "too_many_links",
    });
  });
});

describe("parseNewsBody: refused addresses", () => {
  it("refuses every shortener on the frozen list, also www. and subdomains", () => {
    expect(NEWS_LINK_SHORTENERS).toHaveLength(11);

    for (const domain of NEWS_LINK_SHORTENERS) {
      expect(parseNewsBody(`https://${domain}/abc`)).toEqual({ ok: false, error: "shortener" });
      expect(parseNewsBody(`https://www.${domain}/abc`)).toEqual({ ok: false, error: "shortener" });
    }
  });

  it("refuses a shortener written with trailing dots, capitals or full-width letters (B1)", () => {
    for (const domain of NEWS_LINK_SHORTENERS) {
      for (const host of [
        `${domain}.`,
        `www.${domain}.`,
        `${domain}..`,
        `${domain.toUpperCase()}.`,
      ]) {
        expect(parseNewsBody(`https://${host}/abc`)).toEqual({ ok: false, error: "shortener" });
      }
    }

    expect(parseNewsBody("https://bit.ly./abc")).toEqual({ ok: false, error: "shortener" });
    expect(parseNewsBody("https://bit.ly../abc")).toEqual({ ok: false, error: "shortener" });
    expect(parseNewsBody("https://ｂｉｔ.ｌｙ/abc")).toEqual({ ok: false, error: "shortener" });
  });

  it("does not take a longer domain that merely ends in the same letters for a shortener", () => {
    expect(parseNewsBody("https://hot.co/x").ok).toBe(true);
    expect(parseNewsBody("https://mybit.ly.example/x").ok).toBe(true);
  });

  it("refuses an address with a user name or a password", () => {
    expect(parseNewsBody("https://user@example.org")).toEqual({ ok: false, error: "credentials" });
    expect(parseNewsBody("https://user:pass@example.org")).toEqual({
      ok: false,
      error: "credentials",
    });
    expect(parseNewsBody("https://:pass@example.org")).toEqual({ ok: false, error: "credentials" });
  });

  it("refuses the body for such an address even when it is not the first link", () => {
    expect(parseNewsBody("https://example.org i https://bit.ly/x")).toEqual({
      ok: false,
      error: "shortener",
    });
  });
});

describe("parseNewsBody: international domains (homograph)", () => {
  it("shows an international host in the xn-- form and keeps what was written", () => {
    // Cyrillic "а" (U+0430) in place of the Latin "a".
    const written = "https://gmina-mаlbork.pl/aktualnosci";
    const result = ok(`Zobacz ${written}`);
    const fragment = result.paragraphs[0][1];

    expect(fragment.kind).toBe("link");

    if (fragment.kind === "link") {
      expect(fragment.href).toMatch(/^https:\/\/xn--[a-z0-9-]+\.pl\/aktualnosci$/);
      expect(fragment.text).toBe(fragment.href);
      expect(fragment.original).toBe(written);
    }
  });

  it("shows a Polish letter in the host in the xn-- form too", () => {
    const result = ok("https://łódź.pl");
    const fragment = result.paragraphs[0][0];

    expect(fragment).toMatchObject({ kind: "link", original: "https://łódź.pl" });
    expect(fragment.kind === "link" && fragment.href.startsWith("https://xn--")).toBe(true);
  });

  it("gives no original for an ascii host, also when the path has Polish letters", () => {
    const result = ok("https://example.org/ścieżka");
    const fragment = result.paragraphs[0][0];

    expect(fragment).toMatchObject({ kind: "link", original: null });
    expect(fragment.kind === "link" && fragment.href).toBe("https://example.org/%C5%9Bcie%C5%BCka");
  });

  it("keeps a host that is already in the xn-- form without an original", () => {
    expect(ok("https://xn--ld-pla.pl/x").paragraphs[0][0]).toMatchObject({
      kind: "link",
      original: null,
    });
  });
});

describe("parseNewsBody: limits", () => {
  it("accepts a body of exactly 5000 characters and refuses 5001", () => {
    expect(parseNewsBody("a".repeat(NEWS_BODY_MAX_LENGTH)).ok).toBe(true);
    expect(parseNewsBody("a".repeat(NEWS_BODY_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: "too_long",
    });
  });

  it("counts characters, not UTF-16 units", () => {
    // 5000 characters that are two units each: over 5000 units, within the limit.
    const astral = "\u{1F5FA}".repeat(NEWS_BODY_MAX_LENGTH);

    expect(astral.length).toBe(NEWS_BODY_MAX_LENGTH * 2);
    expect(parseNewsBody(astral).ok).toBe(true);
    expect(parseNewsBody(`${astral}\u{1F5FA}`)).toEqual({ ok: false, error: "too_long" });
    expect(parseNewsBody("\u{1F5FA}".repeat(NEWS_BODY_MAX_LENGTH - 2) + "ab").ok).toBe(true);
  });

  it("counts a CRLF once", () => {
    expect(parseNewsBody("a\r\n".repeat(2500)).ok).toBe(true);
  });

  it("exports the rel attribute of every link", () => {
    expect(NEWS_LINK_REL).toBe("nofollow ugc noopener noreferrer");
  });
});

describe("parseNewsBody: time for hostile input (S3, no catastrophic backtracking)", () => {
  // A normal run takes a few milliseconds; catastrophic backtracking on 5000
  // characters would take orders of magnitude longer. The limit is generous so a busy
  // machine does not fail it (K-16): two warm-up runs, then the median of five.
  const MAX_MS = 500;
  const RUNS = 5;

  function medianMs(body: string): number {
    parseNewsBody(body);
    parseNewsBody(body);

    const times: number[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      const start = performance.now();

      parseNewsBody(body);
      times.push(performance.now() - start);
    }

    times.sort((a, b) => a - b);

    return times[Math.floor(RUNS / 2)];
  }

  const kindsOf = (body: string) => {
    const result = parseNewsBody(body);

    return result.ok
      ? { linkCount: result.linkCount, kinds: result.paragraphs.map((p) => p.map((f) => f.kind)) }
      : result;
  };

  it.each([
    ["one long address", `https://${"a".repeat(4985)}.pl`, 1, [["link"]]],
    ["a long host without a dot", `https://${"a".repeat(4990)}`, 0, [["text"]]],
    ["a thousand scheme starts", "https://".repeat(600), 0, [["text"]]],
    [
      "closing brackets after an address",
      `https://example.org/${")".repeat(4970)}`,
      1,
      [["link", "text"]],
    ],
    [
      "punctuation after an address",
      `https://example.org/${".,;:!?'".repeat(700)}`,
      1,
      [["link", "text"]],
    ],
    ["scheme without end", "https:/".repeat(700), 0, [["text"]]],
    ["many spaces and blank lines", `${" \n".repeat(2400)}x`, 0, [["text"]]],
    ["a long run of angle brackets", `https://a.pl${"<>".repeat(2400)}`, 1, [["link", "text"]]],
    [
      "nested openings",
      `https://example.org/${"(".repeat(2400)}${")".repeat(2400)}`,
      1,
      [["link"]],
    ],
  ])("handles %s quickly and gives the exact result", (_name, body, linkCount, kinds) => {
    expect(kindsOf(body)).toEqual({ linkCount, kinds });
    expect(medianMs(body)).toBeLessThan(MAX_MS);
  });

  it("cuts the closing brackets after an address and keeps them as text", () => {
    const result = ok(`https://example.org/${")".repeat(4970)}`);

    expect(result.paragraphs[0]).toEqual([
      { kind: "link", href: "https://example.org/", text: "https://example.org/", original: null },
      { kind: "text", text: ")".repeat(4970) },
    ]);
  });

  it("returns at once for an oversized body, before normalizing and matching", () => {
    const body = `https://${"a".repeat(2_000_000)}`;

    expect(parseNewsBody(body)).toEqual({ ok: false, error: "too_long" });
    expect(medianMs(body)).toBeLessThan(MAX_MS);
  });

  it("refuses 10001 units before normalizing, and accepts 10000 of two-unit characters", () => {
    expect(parseNewsBody("a".repeat(NEWS_BODY_MAX_LENGTH * 2 + 1))).toEqual({
      ok: false,
      error: "too_long",
    });
    expect(parseNewsBody("\u{1F5FA}".repeat(NEWS_BODY_MAX_LENGTH)).ok).toBe(true);
  });
});

describe("parseNewsBody: addresses of devices and local hosts stay text (N1)", () => {
  it.each([
    "https://localhost/admin",
    "https://intranet/x",
    "https://127.0.0.1/",
    "https://0x7f000001/",
    "https://192.168.0.1:8080/panel",
    "https://[::1]/",
    "https://2130706433/",
  ])("does not make a link of %s", (address) => {
    const result = ok(`Zobacz ${address}`);

    expect(result.linkCount).toBe(0);
    expect(result.paragraphs).toEqual([[{ kind: "text", text: `Zobacz ${address}` }]]);
  });

  it("does not count such an address in the limit of links", () => {
    const body = `${Array.from({ length: 6 }, () => "https://localhost").join(" ")} https://example.org`;

    expect(ok(body).linkCount).toBe(1);
  });
});
