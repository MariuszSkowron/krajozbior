import { describe, expect, it } from "vitest";

import {
  canAddMember,
  isOrganizationKind,
  isOrganizationSlug,
  normalizeOrganizationName,
  ORGANIZATION_KINDS,
  ORGANIZATION_STATUSES,
} from "@/features/organizations/domain/organization";

describe("organization domain", () => {
  it("freezes the six kinds and two statuses", () => {
    expect(ORGANIZATION_KINDS).toEqual([
      "municipality",
      "pttk",
      "local_tourism_org",
      "regional_tourism_org",
      "person",
      "other",
    ]);
    expect(ORGANIZATION_STATUSES).toEqual(["approved", "suspended"]);
  });

  it("recognizes a kind only from the frozen list", () => {
    expect(isOrganizationKind("pttk")).toBe(true);
    expect(isOrganizationKind("company")).toBe(false);
    expect(isOrganizationKind(5)).toBe(false);
  });

  it("accepts lowercase slugs with single hyphens up to 60 characters", () => {
    expect(isOrganizationSlug("gmina-dobra-2")).toBe(true);
    expect(isOrganizationSlug("a".repeat(60))).toBe(true);
    expect(isOrganizationSlug("a".repeat(61))).toBe(false);
    expect(isOrganizationSlug("Gmina")).toBe(false);
    expect(isOrganizationSlug("a--b")).toBe(false);
    expect(isOrganizationSlug("-a")).toBe(false);
    expect(isOrganizationSlug("")).toBe(false);
    expect(isOrganizationSlug(undefined)).toBe(false);
  });

  it("trims a name and requires 1-120 characters", () => {
    expect(normalizeOrganizationName("  Gmina Dobra ")).toBe("Gmina Dobra");
    expect(normalizeOrganizationName("x".repeat(120))).toBe("x".repeat(120));
    expect(normalizeOrganizationName("x".repeat(121))).toBeNull();
    expect(normalizeOrganizationName("   ")).toBeNull();
    expect(normalizeOrganizationName(null)).toBeNull();
    expect(normalizeOrganizationName("Gmin\u{430}")).toBeNull();
    expect(normalizeOrganizationName("Gm\u{200b}ina")).toBeNull();
    expect(normalizeOrganizationName("Gmina   Dobra  Wieś")).toBe("Gmina Dobra Wieś");
    expect(normalizeOrganizationName("Koło Góra")).toBe("Koło Góra");
  });

  // C-05: real names the first, narrower set refused (typographic quotes, slash, dash, accents).
  it.each([
    "Stowarzyszenie \u{201e}Nasza Rumia\u{201d}",
    'Fundacja "Lux Veritatis"',
    "Koło PTTK nr 2 / Oddział Gdynia",
    "PTTK Oddział: Kaszuby",
    "Fundacja Na+",
    "Koło im. O\u{2019}Neilla",
    "Fundacja Müller",
    "Café Literacka",
    "Stowarzyszenie im. Antoniego Dvořáka",
    "Towarzystwo Przyjaciół Ziemi Kłodzkiej \u{2013} Oddział Nysa",
    "Szlak Kopernikowski, Toruń; Sekcja 1!?",
  ])("accepts the real name %s", (name) => {
    expect(normalizeOrganizationName(name)).toBe(name);
  });

  it.each([
    ["Cyrillic a mixed in", "Gmin\u{430} Dobra"],
    ["Greek omicron mixed in", "Gmina Test\u{3bf}wa"],
    ["zero-width space", "Gmina\u{200b}Dobra"],
    ["right-to-left override", "Gmina \u{202e}arboD"],
    ["language tag", "Gmina\u{e0041}Dobra"],
    ["emoji", "Gmina \u{1f332}"],
    ["full-width letters", "\u{ff27}\u{ff4d}\u{ff49}\u{ff4e}\u{ff41}"],
    ["a look-alike of the exclamation mark", "Gmina \u{1c3}"],
    ["a multiplication sign", "Gmina \u{d7}"],
    ["an angle bracket", "Gmina <b>"],
  ])("refuses %s", (_label, name) => {
    expect(normalizeOrganizationName(name)).toBeNull();
  });

  it("lets a person have one member and other kinds any number", () => {
    expect(canAddMember("person", 0)).toBe(true);
    expect(canAddMember("person", 1)).toBe(false);
    expect(canAddMember("municipality", 0)).toBe(true);
    expect(canAddMember("municipality", 25)).toBe(true);
  });
});
