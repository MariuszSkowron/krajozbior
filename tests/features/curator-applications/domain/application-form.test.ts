import { describe, expect, it } from "vitest";

import { validateCuratorApplicationInput } from "@/features/curator-applications/domain/application-form";
import { ORGANIZATION_NAME_MESSAGE } from "@/features/organizations/domain/organization";

const valid = {
  organizationName: "Urząd Miejski w Rumi",
  organizationKind: "municipality",
  applicantRole: "specjalista do spraw promocji",
  contact: "promocja@example.com",
  websiteUrl: "https://www.example.com/bip",
};

describe("validateCuratorApplicationInput", () => {
  it("accepts a complete form", () => {
    expect(validateCuratorApplicationInput(valid)).toEqual({ ok: true, value: valid });
  });

  it.each([undefined, null, "", "   "])("treats %j as no website", (websiteUrl) => {
    expect(validateCuratorApplicationInput({ ...valid, websiteUrl })).toEqual({
      ok: true,
      value: { ...valid, websiteUrl: null },
    });
  });

  it("trims the texts", () => {
    const result = validateCuratorApplicationInput({
      ...valid,
      organizationName: "  Gmina  ",
      websiteUrl: "  https://example.com  ",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { organizationName: "Gmina", websiteUrl: "https://example.com" },
    });
  });

  it("counts the length after trimming", () => {
    expect(
      validateCuratorApplicationInput({ ...valid, organizationName: ` ${"a".repeat(120)} ` }).ok,
    ).toBe(true);
    expect(
      validateCuratorApplicationInput({ ...valid, organizationName: "a".repeat(121) }),
    ).toEqual({
      ok: false,
      fields: ["organizationName"],
      organizationNameMessage: "Nazwa może mieć najwyżej 120 znaków.",
    });
  });

  it("counts the length after folding spaces", () => {
    const name = `${"a ".repeat(30)}${" ".repeat(70)}b`;

    expect(validateCuratorApplicationInput({ ...valid, organizationName: name }).ok).toBe(true);
  });

  it("says why the name is refused: empty, too long, or characters", () => {
    const message = (organizationName: unknown) => {
      const result = validateCuratorApplicationInput({ ...valid, organizationName });

      return result.ok ? null : result.organizationNameMessage;
    };

    expect(message("   ")).toBe("Podaj nazwę organizacji.");
    expect(message(undefined)).toBe("Podaj nazwę organizacji.");
    expect(message("a".repeat(121))).toBe("Nazwa może mieć najwyżej 120 znaków.");
    expect(message("Gmina \u{1f332}")).toBe(ORGANIZATION_NAME_MESSAGE);
    expect(message("Gmina")).toBeNull();
  });

  it("names every wrong field, in the order of the form", () => {
    expect(
      validateCuratorApplicationInput({
        organizationName: "   ",
        organizationKind: "city",
        applicantRole: "",
        contact: "12",
        websiteUrl: "http://example.com",
      }),
    ).toEqual({
      ok: false,
      fields: ["organizationName", "organizationKind", "applicantRole", "contact", "websiteUrl"],
      organizationNameMessage: "Podaj nazwę organizacji.",
    });
  });

  it.each([
    ["zero-width space", "Gmina\u{200b}Testowa"],
    ["right-to-left override", "Gmina \u{202e}atsetoT"],
    ["language tag", "Gmina\u{e0041}Testowa"],
    ["Cyrillic a", "Gmin\u{430} Testowa"],
    ["Greek omicron", "Gmina Test\u{3bf}wa"],
    ["emoji", "Gmina \u{1f332}"],
    ["a forbidden mark", "Gmina <b>"],
    ["full-width letters", "\u{ff27}\u{ff4d}\u{ff49}\u{ff4e}\u{ff41}"],
    ["a look-alike of the exclamation mark", "Gmina \u{1c3}"],
    ["a multiplication sign", "Gmina \u{d7}"],
    ["a combining mark", "Gmina \u{301}"],
  ])("refuses %s in the organization name (C-05)", (_label, organizationName) => {
    expect(validateCuratorApplicationInput({ ...valid, organizationName })).toEqual({
      ok: false,
      fields: ["organizationName"],
      organizationNameMessage: ORGANIZATION_NAME_MESSAGE,
    });
  });

  it("refuses invisible characters in the other texts too", () => {
    for (const field of ["applicantRole", "contact"] as const) {
      expect(validateCuratorApplicationInput({ ...valid, [field]: "ab\u{200b}cd" })).toEqual({
        ok: false,
        fields: [field],
      });
    }
  });

  it("accepts Polish letters and the allowed signs, and normalizes to NFC", () => {
    const name = "Koło PTTK nr 5 (Rumia), o'Neil & Co.-1 ĄąĆćĘęŁłŃńÓóŚśŹźŻż";

    expect(validateCuratorApplicationInput({ ...valid, organizationName: name })).toMatchObject({
      ok: true,
      value: { organizationName: name },
    });
    // "o" + combining acute is composed to the single letter "ó" before the check.
    expect(
      validateCuratorApplicationInput({ ...valid, organizationName: "Koło Góra" }),
    ).toMatchObject({ ok: true, value: { organizationName: "Koło Góra" } });
  });

  it.each([
    "Stowarzyszenie \u{201e}Nasza Rumia\u{201d}",
    "Koło PTTK nr 2 / Oddział Gdynia",
    "Fundacja Müller",
    "Café Literacka",
    "\u{201c}Lux Veritatis\u{201d}",
    "\u{ab}Nasz Dom\u{bb}",
    "Koło \u{2014} Oddział",
    "\u{2018}x\u{2019} \u{201a}y\u{2018}",
    "Towarzystwo Przyjaciół Ziemi Kłodzkiej \u{2013} Oddział Nysa",
  ])("accepts the real name %s (C-05)", (organizationName) => {
    expect(validateCuratorApplicationInput({ ...valid, organizationName })).toMatchObject({
      ok: true,
      value: { organizationName },
    });
  });

  it("folds double spaces in the name to one", () => {
    expect(
      validateCuratorApplicationInput({ ...valid, organizationName: "Gmina   Testowa" }),
    ).toMatchObject({ ok: true, value: { organizationName: "Gmina Testowa" } });
  });

  it("refuses control characters, also the line breaks of a single-line field", () => {
    for (const field of ["organizationName", "applicantRole", "contact"] as const) {
      const extra =
        field === "organizationName" ? { organizationNameMessage: ORGANIZATION_NAME_MESSAGE } : {};

      expect(validateCuratorApplicationInput({ ...valid, [field]: "a\r\nb" })).toEqual({
        ok: false,
        fields: [field],
        ...extra,
      });
      expect(validateCuratorApplicationInput({ ...valid, [field]: "a\u0007b" })).toEqual({
        ok: false,
        fields: [field],
        ...extra,
      });
    }
  });

  it.each([
    "https://",
    "https://exa mple.com",
    "ftp://example.com",
    "example.com",
    `https://example.com/${"a".repeat(200)}`,
    "https://\u0007.example.com",
  ])("refuses the website %j", (websiteUrl) => {
    expect(validateCuratorApplicationInput({ ...valid, websiteUrl })).toEqual({
      ok: false,
      fields: ["websiteUrl"],
    });
  });

  it("refuses a missing or non-text field", () => {
    expect(
      validateCuratorApplicationInput({ ...valid, contact: undefined, applicantRole: 5 }),
    ).toEqual({ ok: false, fields: ["applicantRole", "contact"] });
  });

  it("names no field for an input that is no object", () => {
    expect(validateCuratorApplicationInput(null)).toEqual({ ok: false, fields: [] });
    expect(validateCuratorApplicationInput("text")).toEqual({ ok: false, fields: [] });
  });
});
