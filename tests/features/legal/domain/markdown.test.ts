import { describe, expect, it } from "vitest";

import { isSafeHref, parseInline, parseMarkdown, slugify } from "@/features/legal/domain/markdown";

describe("isSafeHref", () => {
  it.each(["https://a.pl", "http://a.pl/x", "mailto:a@b.pl", "/regulamin", "HTTPS://A.PL"])(
    "lets %s through",
    (href) => {
      expect(isSafeHref(href)).toBe(true);
    },
  );

  it.each(["javascript:alert(1)", "//evil.example", "data:text/html,x", "regulamin", ""])(
    "refuses %j",
    (href) => {
      expect(isSafeHref(href)).toBe(false);
    },
  );
});

describe("parseInline", () => {
  it("keeps plain text whole", () => {
    expect(parseInline("zwykły tekst")).toEqual([{ kind: "text", text: "zwykły tekst" }]);
  });

  it("reads bold, italic, a link and an autolink between pieces of text", () => {
    expect(
      parseInline("a **b** c *d* e [f](https://g.pl) h <https://i.pl> j <mailto:k@l.pl>"),
    ).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", text: "b" },
      { kind: "text", text: " c " },
      { kind: "em", text: "d" },
      { kind: "text", text: " e " },
      { kind: "link", text: "f", href: "https://g.pl" },
      { kind: "text", text: " h " },
      { kind: "link", text: "https://i.pl", href: "https://i.pl" },
      { kind: "text", text: " j " },
      { kind: "link", text: "k@l.pl", href: "mailto:k@l.pl" },
    ]);
  });

  it("starts and ends with a mark without empty text pieces", () => {
    expect(parseInline("**a**[b](/c)")).toEqual([
      { kind: "strong", text: "a" },
      { kind: "link", text: "b", href: "/c" },
    ]);
  });

  it("leaves an unsafe link as the text it was written as", () => {
    expect(parseInline("x [klik](javascript:x) y")).toEqual([
      { kind: "text", text: "x " },
      { kind: "text", text: "[klik](javascript:x)" },
      { kind: "text", text: " y" },
    ]);
  });

  it("returns nothing for an empty string", () => {
    expect(parseInline("")).toEqual([]);
  });
});

describe("slugify", () => {
  it.each([
    ["Rozdział 1. Postanowienia ogólne", "rozdzial-1-postanowienia-ogolne"],
    ["Łódź, żółć", "lodz-zolc"],
    ["  --A--  ", "a"],
    ["5. Zdjęcia", "5-zdjecia"],
  ])("turns %j into %j", (text, id) => {
    expect(slugify(text)).toBe(id);
  });
});

describe("parseMarkdown", () => {
  it("reads headings of two levels with anchors and numbers a repeated one", () => {
    expect(parseMarkdown("## Zasady\n\n### Zasady\n\n## Zasady")).toEqual([
      { kind: "heading", level: 2, text: "Zasady", id: "zasady" },
      { kind: "heading", level: 3, text: "Zasady", id: "zasady-2" },
      { kind: "heading", level: 2, text: "Zasady", id: "zasady-3" },
    ]);
  });

  it("joins the lines of a paragraph and ends it at a blank line, a heading, a table or a list", () => {
    const blocks = parseMarkdown(
      "pierwsza\n  druga\n\ntrzecia\n## H\nczwarta\n| a |\npiąta\n- x\nszósta",
    );

    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "paragraph",
      "heading",
      "paragraph",
      "table",
      "paragraph",
      "list",
      "paragraph",
    ]);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      inlines: [{ kind: "text", text: "pierwsza druga" }],
    });
  });

  it("reads a table with a header, a separator and rows", () => {
    expect(parseMarkdown("| A | B |\n| --- | --- |\n| **1** | 2 |\n| 3 | [4](/x) |")).toEqual([
      {
        kind: "table",
        header: [[{ kind: "text", text: "A" }], [{ kind: "text", text: "B" }]],
        rows: [
          [[{ kind: "strong", text: "1" }], [{ kind: "text", text: "2" }]],
          [[{ kind: "text", text: "3" }], [{ kind: "link", text: "4", href: "/x" }]],
        ],
      },
    ]);
  });

  it("reads flat bullet and numbered lists", () => {
    expect(parseMarkdown("- a\n- b")).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          { inlines: [{ kind: "text", text: "a" }], children: [] },
          { inlines: [{ kind: "text", text: "b" }], children: [] },
        ],
      },
    ]);
    expect(parseMarkdown("1. a\n2. b")).toMatchObject([{ kind: "list", ordered: true }]);
  });

  it("keeps the first number of a numbered list that continues after a paragraph", () => {
    const blocks = parseMarkdown(["1. a", "", "akapit", "", "2. b", "3. c"].join("\n"));

    expect(blocks).toMatchObject([
      { kind: "list", ordered: true },
      { kind: "paragraph" },
      { kind: "list", ordered: true, start: 2 },
    ]);
    expect(blocks[0]).not.toHaveProperty("start");
  });

  it("nests lists by indentation and climbs back out", () => {
    const [list] = parseMarkdown(
      ["1. a", "   1. a1", "   2. a2", "      - a2x", "2. b", "   - b1", "3. c"].join("\n"),
    );

    expect(list).toMatchObject({ kind: "list", ordered: true });
    if (list?.kind !== "list") {
      throw new Error("a list was expected");
    }

    expect(list.items.map((item) => item.inlines)).toEqual([
      [{ kind: "text", text: "a" }],
      [{ kind: "text", text: "b" }],
      [{ kind: "text", text: "c" }],
    ]);
    expect(list.items[0]!.children).toHaveLength(1);
    expect(list.items[0]!.children[0]).toMatchObject({ ordered: true });
    expect(list.items[0]!.children[0]!.items).toHaveLength(2);
    expect(list.items[0]!.children[0]!.items[1]!.children[0]).toMatchObject({
      ordered: false,
      items: [{ inlines: [{ kind: "text", text: "a2x" }] }],
    });
    expect(list.items[1]!.children[0]).toMatchObject({ ordered: false });
    expect(list.items[2]!.children).toEqual([]);
  });

  it("reads Windows line endings like Unix ones", () => {
    expect(parseMarkdown("## A\r\n\r\ntekst\r\n- x")).toEqual(parseMarkdown("## A\n\ntekst\n- x"));
  });

  it("returns nothing for an empty text", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n \n")).toEqual([]);
  });
});
