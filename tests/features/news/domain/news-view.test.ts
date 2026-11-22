import { describe, expect, it } from "vitest";

import {
  NEWS_EVENT_FILTER_LIMIT,
  NEWS_LIST_LIMIT,
  formatEventDays,
  formatNewsDate,
  isNewsSlug,
  newsBodyParagraphs,
  newsDateTime,
  organizationInitial,
  parseNewsFilter,
} from "@/features/news/domain/news-view";

describe("isNewsSlug", () => {
  it.each(["jak-zbierac-miejsca", "a", "aktualnosc-2", "x".repeat(80)])("accepts %s", (slug) => {
    expect(isNewsSlug(slug)).toBe(true);
  });

  it.each(["", "Zły", "ma spacje", "-start", "end-", "dwa--myslniki", "x".repeat(81), "a/b", "ą"])(
    "refuses %j",
    (slug) => {
      expect(isNewsSlug(slug)).toBe(false);
    },
  );

  it("refuses what is not a string", () => {
    expect(isNewsSlug(undefined)).toBe(false);
    expect(isNewsSlug(7)).toBe(false);
  });
});

describe("parseNewsFilter", () => {
  it("knows only the filter of events", () => {
    expect(parseNewsFilter("wydarzenia")).toBe("events");
    expect(parseNewsFilter(["wydarzenia", "inne"])).toBe("events");
    expect(parseNewsFilter(["inne", "wydarzenia"])).toBeNull();
    expect(parseNewsFilter("Wydarzenia")).toBeNull();
    expect(parseNewsFilter("poradniki")).toBeNull();
    expect(parseNewsFilter(undefined)).toBeNull();
    expect(parseNewsFilter([])).toBeNull();
  });
});

describe("dates", () => {
  it("writes a moment as a day in Poland, whatever the zone of the server", () => {
    // 23:30 UTC on 16 April is already 17 April in Poland (summer time).
    const moment = new Date("2027-04-16T23:30:00Z");

    expect(formatNewsDate(moment)).toBe("17.04.2027");
    expect(formatNewsDate(new Date("2026-11-08T10:00:00Z"))).toBe("8.11.2026");
    expect(newsDateTime(moment)).toBe("2027-04-17");
  });

  it("writes the days of an event", () => {
    expect(formatEventDays("2027-04-17", null)).toBe("17.04.2027");
    expect(formatEventDays("2027-04-17", "2027-04-17")).toBe("17.04.2027");
    expect(formatEventDays("2027-04-17", "2027-04-18")).toBe("17–18.04.2027");
    expect(formatEventDays("2027-04-30", "2027-05-02")).toBe("30.04–2.05.2027");
    expect(formatEventDays("2027-12-31", "2028-01-02")).toBe("31.12.2027–2.01.2028");
  });
});

describe("organizationInitial", () => {
  it("is the first letter in upper case", () => {
    expect(organizationInitial("Krajozbiór — redakcja")).toBe("K");
    expect(organizationInitial("  łódzkie muzeum")).toBe("Ł");
    expect(organizationInitial("😀 grupa")).toBe("😀");
  });

  it("is a question mark for an empty name", () => {
    expect(organizationInitial("")).toBe("?");
    expect(organizationInitial("   ")).toBe("?");
  });
});

describe("newsBodyParagraphs", () => {
  it("returns the paragraphs of the parser, with https links as link fragments", () => {
    expect(newsBodyParagraphs("Pierwszy.\n\nZobacz https://example.org/a.")).toEqual([
      [{ kind: "text", text: "Pierwszy." }],
      [
        { kind: "text", text: "Zobacz " },
        {
          kind: "link",
          href: "https://example.org/a",
          text: "https://example.org/a",
          original: null,
        },
        { kind: "text", text: "." },
      ],
    ]);
  });

  it("shows markup and other schemes as plain text", () => {
    const [paragraph] = newsBodyParagraphs(
      '<script>x</script> <img src=x onerror="y"> javascript:alert(1) http://example.com',
    );

    expect(paragraph?.every((fragment) => fragment.kind === "text")).toBe(true);
  });

  it("is empty for an empty body", () => {
    expect(newsBodyParagraphs("")).toEqual([]);
  });

  it("falls back to plain paragraphs, never links, for a body the parser refuses", () => {
    // A shortener is refused by the parser; data that bypassed the import must not become a link.
    const body = "Skrót https://bit.ly/abc\r\n\r\n  \r\nDrugi akapit\nw dwóch wierszach";

    expect(newsBodyParagraphs(body)).toEqual([
      [{ kind: "text", text: "Skrót https://bit.ly/abc" }],
      [{ kind: "text", text: "Drugi akapit\nw dwóch wierszach" }],
    ]);
  });
});

describe("limits", () => {
  it("reads at most 50 newest items and 200 events before the filter", () => {
    expect(NEWS_LIST_LIMIT).toBe(50);
    expect(NEWS_EVENT_FILTER_LIMIT).toBe(200);
  });
});
