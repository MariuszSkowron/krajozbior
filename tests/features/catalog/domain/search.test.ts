import { describe, expect, it } from "vitest";

import { REGIONS, REGION_LABELS } from "@/features/catalog/domain/collection";
import {
  ASCII_TWINS,
  REGION_LOCATIVE,
  remainingBudgetMs,
  LATIN_CAPITALS,
  LATIN_SMALLS,
  POLISH_LETTERS,
  SEARCH_MAX_LENGTH,
  describeFound,
  escapeLikeText,
  foldSearchText,
  foldSql,
  formatCollectionCount,
  parseSearchPhrase,
  parseSearchRegion,
  rankSearchHits,
  regionsNamedLike,
  sortByTitle,
} from "@/features/catalog/domain/search";

import { FOLD_CASES } from "../../../support/search-fold-cases";

describe("character table", () => {
  it("has a twin for every Polish letter", () => {
    expect(Array.from(POLISH_LETTERS)).toHaveLength(ASCII_TWINS.length);
    expect(POLISH_LETTERS).toHaveLength(18);
  });

  it("has a small letter for every other Latin capital", () => {
    expect(Array.from(LATIN_CAPITALS)).toHaveLength(LATIN_SMALLS.length);
    expect(LATIN_CAPITALS.toLowerCase()).toBe(LATIN_SMALLS);
  });
});

describe("foldSearchText", () => {
  it.each(FOLD_CASES)("folds %s to %s", (text, folded) => {
    expect(foldSearchText(text)).toBe(folded);
  });

  it("composes a letter written as a base and an accent before folding", () => {
    expect(foldSearchText("Wieża")).toBe("wieza");
    expect(foldSearchText("Zółw")).toBe("zolw");
  });

  it("leaves the text of the demo as it is, only lowered", () => {
    expect(foldSearchText("Mosty i Zamki")).toBe("mosty i zamki");
  });
});

describe("foldSql", () => {
  it("names the same table and wraps the column", () => {
    expect(foldSql("c.title")).toBe(
      `lower(translate(c.title, '${POLISH_LETTERS}${LATIN_CAPITALS}', '${ASCII_TWINS}${LATIN_SMALLS}'))`,
    );
  });
});

describe("remainingBudgetMs", () => {
  it("gives the second query what the first left, at least 1 ms, a whole number", () => {
    expect(remainingBudgetMs(2000, 0)).toBe(2000);
    expect(remainingBudgetMs(2000, 430.7)).toBe(1569);
    expect(remainingBudgetMs(2000, 2000)).toBe(1);
    expect(remainingBudgetMs(2000, 5000)).toBe(1);
  });
});

describe("REGION_LOCATIVE", () => {
  it("has a locative form for all 16 regions, in the case that follows the label", () => {
    expect(Object.keys(REGION_LOCATIVE).sort()).toEqual([...REGIONS].sort());
    expect(REGIONS).toHaveLength(16);

    for (const region of REGIONS) {
      const label = foldSearchText(REGION_LABELS[region]);
      const form = foldSearchText(REGION_LOCATIVE[region]);

      expect(form).toMatch(/(im|ym)$/);
      // the stem (without the ending "-ie" / "-im") is the same as in the label
      expect(form.slice(0, -2)).toBe(label.slice(0, -2));
    }

    expect(REGION_LOCATIVE.pomorskie).toBe("pomorskim");
    expect(REGION_LOCATIVE.lodzkie).toBe("łódzkim");
  });
});

describe("escapeLikeText", () => {
  it("escapes the three special characters", () => {
    expect(escapeLikeText("100%_a\\b")).toBe("100\\%\\_a\\\\b");
    expect(escapeLikeText("zwykły")).toBe("zwykły");
  });
});

describe("parseSearchPhrase", () => {
  it("treats a missing and a blank phrase as none", () => {
    expect(parseSearchPhrase(undefined)).toEqual({ status: "none" });
    expect(parseSearchPhrase("   \n ")).toEqual({ status: "none" });
  });

  it("refuses 1 character and more than 80", () => {
    expect(parseSearchPhrase(" a ")).toEqual({ status: "too_short" });
    expect(parseSearchPhrase("a".repeat(SEARCH_MAX_LENGTH + 1))).toEqual({ status: "too_long" });
  });

  it("counts characters, not bytes, and spaces once", () => {
    expect(parseSearchPhrase("ł".repeat(SEARCH_MAX_LENGTH)).status).toBe("ok");
    expect(parseSearchPhrase(`a${" ".repeat(200)}b`)).toMatchObject({
      status: "ok",
      display: "a b",
    });
  });

  // LIVE-6: PostgreSQL refuses a NUL in text, so the query failed (error 500 and the phrase in
  // the database log). Control characters never reach the database; they separate words.
  it("turns control characters, NUL included, into a space before the database", () => {
    expect(parseSearchPhrase("wie\u0000ża")).toMatchObject({ status: "ok", display: "wie ża" });
    expect(parseSearchPhrase("zam\u0007ek\u001b[0m\u0085x")).toMatchObject({
      status: "ok",
      display: "zam ek [0m x",
    });
    expect(parseSearchPhrase("\u0000\u0000")).toEqual({ status: "none" });
    expect(parseSearchPhrase("a\u0000")).toEqual({ status: "too_short" });

    const phrase = parseSearchPhrase("\u0000ab\u0000");

    expect(phrase.status === "ok" && /\p{Cc}/u.test(phrase.contains + phrase.prefix)).toBe(false);
  });

  it("gives the folded phrase and the escaped like patterns", () => {
    expect(parseSearchPhrase("  WIEŻA   50% ")).toEqual({
      status: "ok",
      display: "WIEŻA 50%",
      folded: "wieza 50%",
      contains: "%wieza 50\\%%",
      prefix: "wieza 50\\%%",
    });
  });
});

describe("parseSearchRegion", () => {
  it("accepts a region code and ignores anything else", () => {
    expect(parseSearchRegion("pomorskie")).toBe("pomorskie");
    expect(parseSearchRegion("Pomorskie")).toBeNull();
    expect(parseSearchRegion("")).toBeNull();
    expect(parseSearchRegion(undefined)).toBeNull();
  });
});

describe("regionsNamedLike", () => {
  it("finds the regions whose name starts with the phrase", () => {
    expect(regionsNamedLike("pomor")).toEqual(["pomorskie"]);
    expect(regionsNamedLike("lodz")).toEqual(["lodzkie"]);
    expect(regionsNamedLike("lu")).toEqual(["lubelskie", "lubuskie"]);
    expect(regionsNamedLike("wieza")).toEqual([]);
  });
});

describe("rankSearchHits", () => {
  const titles = ["Żuk wieży", "Wieża", "Zamek na wieży", "Ćma", "Wieże dwie"];
  const title = (text: string) => text;

  it("puts titles that start with the phrase first, then the rest, each in Polish order", () => {
    expect(rankSearchHits(titles, title, "wiez", 10)).toEqual([
      "Wieża",
      "Wieże dwie",
      "Ćma",
      "Zamek na wieży",
      "Żuk wieży",
    ]);
  });

  it("cuts the list and does not change the input", () => {
    const input = ["b", "a", "c"];

    expect(rankSearchHits(input, title, "zz", 2)).toEqual(["a", "b"]);
    expect(input).toEqual(["b", "a", "c"]);
  });
});

describe("sortByTitle", () => {
  it("sorts alphabetically with Polish letters in place", () => {
    expect(sortByTitle(["Zamek", "Łódź", "Lublin", "Żary"], (t) => t)).toEqual([
      "Lublin",
      "Łódź",
      "Zamek",
      "Żary",
    ]);
  });
});

describe("describeFound", () => {
  it.each([
    [3, 5, "Znaleziono 3 kolekcje i 5 miejsc"],
    [1, 1, "Znaleziono 1 kolekcję i 1 miejsce"],
    [5, 2, "Znaleziono 5 kolekcji i 2 miejsca"],
    [12, 22, "Znaleziono 12 kolekcji i 22 miejsca"],
    [2, 0, "Znaleziono 2 kolekcje"],
    [0, 14, "Znaleziono 14 miejsc"],
    [0, 0, "Nic nie znaleziono"],
  ])("writes %i collections and %i places as „%s”", (collections, places, text) => {
    expect(describeFound(collections, places)).toBe(text);
  });
});

describe("formatCollectionCount", () => {
  it.each([
    [0, "0 kolekcji"],
    [1, "1 kolekcja"],
    [3, "3 kolekcje"],
    [13, "13 kolekcji"],
    [23, "23 kolekcje"],
  ])("writes %i as %s", (count, text) => {
    expect(formatCollectionCount(count)).toBe(text);
  });
});
