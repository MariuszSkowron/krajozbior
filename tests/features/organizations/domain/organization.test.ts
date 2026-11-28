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
    expect(normalizeOrganizationName("Gminа")).toBeNull();
    expect(normalizeOrganizationName("Gm​ina")).toBeNull();
    expect(normalizeOrganizationName("Koło Góra")).toBe("Koło Góra");
  });

  it("lets a person have one member and other kinds any number", () => {
    expect(canAddMember("person", 0)).toBe(true);
    expect(canAddMember("person", 1)).toBe(false);
    expect(canAddMember("municipality", 0)).toBe(true);
    expect(canAddMember("municipality", 25)).toBe(true);
  });
});
