import { describe, expect, it } from "vitest";

import { validateCuratorApplicationInput } from "@/features/curator-applications/domain/application-form";

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
    ).toEqual({ ok: false, fields: ["organizationName"] });
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
    });
  });

  it.each([
    ["zero-width space", "Gmina​Testowa"],
    ["right-to-left override", "Gmina ‮atsetoT"],
    ["language tag", "Gmina\u{e0041}Testowa"],
    ["Cyrillic a", "Gminа Testowa"],
    ["Greek omicron", "Gmina Testοwa"],
    ["emoji", "Gmina 🌲"],
    ["a forbidden mark", "Gmina <b>"],
  ])("refuses %s in the organization name (C-05)", (_label, organizationName) => {
    expect(validateCuratorApplicationInput({ ...valid, organizationName })).toEqual({
      ok: false,
      fields: ["organizationName"],
    });
  });

  it("refuses invisible characters in the other texts too", () => {
    for (const field of ["applicantRole", "contact"] as const) {
      expect(validateCuratorApplicationInput({ ...valid, [field]: "ab​cd" })).toEqual({
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

  it("refuses control characters, also the line breaks of a single-line field", () => {
    for (const field of ["organizationName", "applicantRole", "contact"] as const) {
      expect(validateCuratorApplicationInput({ ...valid, [field]: "a\r\nb" })).toEqual({
        ok: false,
        fields: [field],
      });
      expect(validateCuratorApplicationInput({ ...valid, [field]: "a\u0007b" })).toEqual({
        ok: false,
        fields: [field],
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
